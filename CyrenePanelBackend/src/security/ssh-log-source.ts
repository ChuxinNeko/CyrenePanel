/**
 * SSH 日志的读取（有副作用的那半：执行命令、读文件），
 * 解析逻辑在 ssh-log.ts 里保持纯净。
 */

import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { platform } from "os";

export interface SshLogSource {
  /** journalctl / auth.log / secure / none */
  kind: string;
  content: string;
  message?: string;
}

const LOG_FILES = ["/var/log/auth.log", "/var/log/secure"];

/**
 * 按可用性依次尝试。
 * Ubuntu 22.04 起 sshd 默认只写 journald，auth.log 可能存在但一条 sshd 记录都没有，
 * 所以 journalctl 优先，并且拿到空结果时继续往下退。
 */
export function readSshLog(maxLines = 4000): SshLogSource {
  if (platform() === "win32") {
    return { kind: "none", content: "", message: "Windows 无 SSH 服务端日志" };
  }

  try {
    // -u ssh 和 -u sshd 两个单元名在不同发行版上都出现过，一起给
    const output = execFileSync(
      "journalctl",
      ["-u", "ssh", "-u", "sshd", "--no-pager", "-o", "short-iso", "-n", String(maxLines)],
      { encoding: "utf-8", timeout: 8000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (output.includes("sshd")) return { kind: "journalctl", content: output };
  } catch {
    // 没有 systemd 或没权限，继续退到文件
  }

  for (const file of LOG_FILES) {
    try {
      if (!existsSync(file)) continue;
      const content = readFileSync(file, "utf-8");
      if (!content.includes("sshd")) continue;
      // 文件可能很大（实测 9MB），只取尾部
      const lines = content.split("\n");
      return {
        kind: file,
        content: lines.slice(Math.max(0, lines.length - maxLines)).join("\n"),
      };
    } catch {
      // 权限不足就试下一个
    }
  }

  return {
    kind: "none",
    content: "",
    message: "未找到可读的 SSH 日志（journalctl 与 /var/log/auth.log 均不可用）",
  };
}
