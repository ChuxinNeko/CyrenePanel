import { connect as netConnect, Socket } from "net";
import { connect as tlsConnect, TLSSocket } from "tls";

export interface SmtpConfig {
  host: string;
  port: number;
  // "ssl" = implicit TLS (465), "starttls" = upgrade after EHLO (587), "none" = plain (not recommended)
  encryption: "ssl" | "starttls" | "none";
  user: string;
  pass: string;
  from: string; // e.g. "CyrenePanel <noreply@example.com>" or plain address
  timeoutMs?: number;
}

export interface SmtpMail {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
}

class SmtpDialog {
  private sock: Socket | TLSSocket;
  private buffer = "";
  private resolvers: Array<(line: string) => void> = [];
  private rejector: ((err: Error) => void) | null = null;

  constructor(sock: Socket | TLSSocket) {
    this.sock = sock;
    this.sock.setEncoding("utf-8");
    this.sock.on("data", (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.findReplyEnd()) !== -1) {
        const reply = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx);
        const resolver = this.resolvers.shift();
        if (resolver) resolver(reply);
      }
    });
    this.sock.on("error", (err) => {
      const r = this.rejector;
      if (r) r(err);
    });
    this.sock.on("close", () => {
      const r = this.rejector;
      if (r) r(new Error("SMTP 连接已关闭"));
    });
  }

  private findReplyEnd(): number {
    // Multi-line SMTP reply ends with a line "NNN <SP>...<CRLF>"
    const lines = this.buffer.split(/\r?\n/);
    let offset = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      const line = lines[i];
      offset += line.length;
      // include the line break
      const nlMatch = this.buffer.slice(offset).match(/^\r?\n/);
      offset += nlMatch ? nlMatch[0].length : 1;
      if (/^\d{3} /.test(line)) {
        return offset;
      }
    }
    return -1;
  }

  setRejector(rej: (err: Error) => void) {
    this.rejector = rej;
  }

  readReply(): Promise<string> {
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  write(line: string): void {
    this.sock.write(line + "\r\n");
  }

  upgradeTls(host: string): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      const tlsSock = tlsConnect({ socket: this.sock as Socket, servername: host });
      tlsSock.once("secureConnect", () => {
        this.sock = tlsSock;
        this.sock.setEncoding("utf-8");
        this.buffer = "";
        this.sock.on("data", (chunk: string) => {
          this.buffer += chunk;
          let idx: number;
          while ((idx = this.findReplyEnd()) !== -1) {
            const reply = this.buffer.slice(0, idx);
            this.buffer = this.buffer.slice(idx);
            const resolver = this.resolvers.shift();
            if (resolver) resolver(reply);
          }
        });
        this.sock.on("error", (err) => {
          const r = this.rejector;
          if (r) r(err);
        });
        this.sock.on("close", () => {
          const r = this.rejector;
          if (r) r(new Error("SMTP 连接已关闭"));
        });
        resolve(tlsSock);
      });
      tlsSock.once("error", reject);
    });
  }

  end(): void {
    try {
      this.sock.end();
    } catch {
      // ignore
    }
  }
}

function ensureOk(reply: string, expected: number): void {
  const code = parseInt(reply.slice(0, 3), 10);
  if (!Number.isFinite(code)) throw new Error(`SMTP 返回非数字状态码: ${reply.trim()}`);
  // Accept any 2xx (or 3xx for AUTH continuation)
  if (Math.floor(code / 100) === Math.floor(expected / 100)) return;
  if (expected === 235 && code === 235) return;
  throw new Error(`SMTP 期望 ${expected}，但收到: ${reply.trim()}`);
}

function dotStuff(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
    .map((l) => (l.startsWith(".") ? "." + l : l)).join("\r\n");
}

function buildMime(from: string, to: string[], subject: string, text: string, html?: string): string {
  const boundary = "----=_CyreneAlert_" + Math.random().toString(36).slice(2);
  const date = new Date().toUTCString();
  const id = `<${Date.now()}.${Math.random().toString(36).slice(2)}@cyrenepanel>`;

  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`;

  const headers = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodedSubject}`,
    `Date: ${date}`,
    `Message-ID: ${id}`,
    `MIME-Version: 1.0`,
  ];

  let body: string;
  if (html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(text, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(html, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n"),
      ``,
      `--${boundary}--`,
      ``,
    ].join("\r\n");
  } else {
    headers.push(`Content-Type: text/plain; charset=UTF-8`);
    headers.push(`Content-Transfer-Encoding: base64`);
    body = "\r\n" + Buffer.from(text, "utf-8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  }
  return headers.join("\r\n") + "\r\n" + body;
}

function extractAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m ? m[1] : addr).trim();
}

export async function sendMail(cfg: SmtpConfig, mail: SmtpMail): Promise<void> {
  if (!cfg.host || !cfg.port) throw new Error("SMTP host/port 未配置");
  if (!cfg.from) throw new Error("SMTP 发件人未配置");
  const toList = Array.isArray(mail.to) ? mail.to : mail.to.split(/[,;\s]+/).filter(Boolean);
  if (toList.length === 0) throw new Error("收件人为空");

  const timeoutMs = cfg.timeoutMs ?? 15000;
  let sock: Socket | TLSSocket;
  if (cfg.encryption === "ssl") {
    sock = tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("SMTP TLS 连接超时")), timeoutMs);
      (sock as TLSSocket).once("secureConnect", () => { clearTimeout(t); resolve(); });
      sock.once("error", (err) => { clearTimeout(t); reject(err); });
    });
  } else {
    sock = netConnect({ host: cfg.host, port: cfg.port });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("SMTP 连接超时")), timeoutMs);
      sock.once("connect", () => { clearTimeout(t); resolve(); });
      sock.once("error", (err) => { clearTimeout(t); reject(err); });
    });
  }

  const dialog = new SmtpDialog(sock);
  const overallTimeout = setTimeout(() => {
    try { sock.destroy(new Error("SMTP 整体超时")); } catch { /* ignore */ }
  }, timeoutMs * 4);

  try {
    await new Promise<void>(async (resolve, reject) => {
      dialog.setRejector(reject);
      try {
        ensureOk(await dialog.readReply(), 220);

        const ehloHost = "cyrenepanel.local";
        dialog.write(`EHLO ${ehloHost}`);
        let ehloReply = await dialog.readReply();
        ensureOk(ehloReply, 250);

        if (cfg.encryption === "starttls") {
          dialog.write("STARTTLS");
          ensureOk(await dialog.readReply(), 220);
          await dialog.upgradeTls(cfg.host);
          dialog.write(`EHLO ${ehloHost}`);
          ehloReply = await dialog.readReply();
          ensureOk(ehloReply, 250);
        }

        if (cfg.user) {
          dialog.write("AUTH LOGIN");
          ensureOk(await dialog.readReply(), 334);
          dialog.write(Buffer.from(cfg.user, "utf-8").toString("base64"));
          ensureOk(await dialog.readReply(), 334);
          dialog.write(Buffer.from(cfg.pass || "", "utf-8").toString("base64"));
          ensureOk(await dialog.readReply(), 235);
        }

        dialog.write(`MAIL FROM:<${extractAddress(cfg.from)}>`);
        ensureOk(await dialog.readReply(), 250);
        for (const r of toList) {
          dialog.write(`RCPT TO:<${extractAddress(r)}>`);
          ensureOk(await dialog.readReply(), 250);
        }
        dialog.write("DATA");
        ensureOk(await dialog.readReply(), 354);

        const mime = buildMime(cfg.from, toList, mail.subject, mail.text, mail.html);
        dialog.write(dotStuff(mime));
        dialog.write(".");
        ensureOk(await dialog.readReply(), 250);

        dialog.write("QUIT");
        try { await dialog.readReply(); } catch { /* ignore */ }
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  } finally {
    clearTimeout(overallTimeout);
    dialog.end();
  }
}
