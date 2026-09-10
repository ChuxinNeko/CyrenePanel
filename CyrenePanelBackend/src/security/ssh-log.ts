/**
 * SSH 登录日志解析。
 *
 * 日志来源按可用性依次尝试：
 * 1. journalctl（Ubuntu 22.04 起 sshd 默认只写 journald，auth.log 里可能一条都没有）
 * 2. /var/log/auth.log（Debian 系传统位置）
 * 3. /var/log/secure（RHEL 系）
 *
 * 解析函数是纯的，便于脱离 Linux 用真实样本验证。
 */

export interface SshLogEntry {
  /** 同一毫秒内可能有多条，用 序号 保证 key 唯一 */
  id: string;
  timestamp: number;
  user: string;
  ip: string;
  port: number | null;
  /** password / publickey / none 等 */
  method: string;
  success: boolean;
  /** 失败原因，成功时为空 */
  reason: string;
}

/**
 * syslog 传统格式不带年份（"Sep 10 23:11:13"），只能按"不晚于当前时间"来推：
 * 如果按今年解析出来是未来时间，说明是去年的记录。
 */
function parseSyslogDate(month: string, day: string, time: string, now: Date): number {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = months.indexOf(month);
  if (monthIndex < 0) return 0;
  const [h, m, s] = time.split(":").map(Number);
  let year = now.getFullYear();
  let ts = new Date(year, monthIndex, Number(day), h || 0, m || 0, s || 0).getTime();
  // 留 1 天容差，避免时钟微小偏差把今天的记录判成去年
  if (ts > now.getTime() + 86_400_000) {
    ts = new Date(year - 1, monthIndex, Number(day), h || 0, m || 0, s || 0).getTime();
  }
  return ts;
}

/** 从一行日志里取出时间戳，兼容 short-iso 与传统 syslog 两种格式 */
export function parseLogTimestamp(line: string, now = new Date()): number {
  const iso = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[+-]\d{2}:\d{2}|Z)?)/);
  if (iso) {
    const ts = Date.parse(iso[1]);
    if (Number.isFinite(ts)) return ts;
  }
  const syslog = line.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})/);
  if (syslog) return parseSyslogDate(syslog[1], syslog[2], syslog[3], now);
  return 0;
}

/**
 * 解析 sshd 认证结果行。只认最终结论，不收 preauth / pam_unix 之类的中间过程，
 * 否则一次登录会在列表里刷出四五条。
 */
export function parseSshLogLines(content: string, now = new Date()): SshLogEntry[] {
  const entries: SshLogEntry[] = [];
  let seq = 0;

  for (const line of content.split("\n")) {
    if (!line.includes("sshd")) continue;

    let user = "";
    let ip = "";
    let port: number | null = null;
    let method = "";
    let success = false;
    let reason = "";

    // Accepted password for root from 1.2.3.4 port 39232 ssh2
    const accepted = line.match(
      /Accepted\s+(\S+)\s+for\s+(\S+)\s+from\s+(\S+)\s+port\s+(\d+)/,
    );
    // Failed password for root from 1.2.3.4 port 54410 ssh2
    // Failed password for invalid user admin from 1.2.3.4 port 111 ssh2
    const failed = line.match(
      /Failed\s+(\S+)\s+for\s+(?:(invalid user)\s+)?(\S+)\s+from\s+(\S+)\s+port\s+(\d+)/,
    );
    // Invalid user admin from 1.2.3.4 port 111
    const invalid = line.match(/Invalid user\s+(\S*)\s+from\s+(\S+)(?:\s+port\s+(\d+))?/);

    if (accepted) {
      method = accepted[1];
      user = accepted[2];
      ip = accepted[3];
      port = Number(accepted[4]);
      success = true;
    } else if (failed) {
      method = failed[1];
      user = failed[3];
      ip = failed[4];
      port = Number(failed[5]);
      success = false;
      reason = failed[2] ? "用户不存在" : "认证失败";
    } else if (invalid) {
      method = "none";
      user = invalid[1] || "(空)";
      ip = invalid[2];
      port = invalid[3] ? Number(invalid[3]) : null;
      success = false;
      reason = "用户不存在";
    } else {
      continue;
    }

    // 少数格式里 from 后面跟的是主机名而非 IP，这类记录留着但归属地查不出来
    if (!ip) continue;

    entries.push({
      id: `${seq++}`,
      timestamp: parseLogTimestamp(line, now),
      user,
      ip,
      port: Number.isFinite(port as number) ? port : null,
      method,
      success,
      reason,
    });
  }

  // 新的在前
  return entries.sort((a, b) => b.timestamp - a.timestamp);
}
