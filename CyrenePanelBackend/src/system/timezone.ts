/**
 * 服务器自身的时区。
 *
 * 日志里的时间是服务器记的，前端按浏览器时区渲染会整体平移几个小时，
 * 跨时区运维时和 journalctl / access.log 的输出对不上，所以把时区一并发给前端。
 */

export interface ServerTimezone {
  /** IANA 名，如 Asia/Shanghai。运行时缺 ICU 时为空串 */
  name: string;
  /** 东为正 */
  offsetMinutes: number;
  /** 形如 UTC+08:00 */
  label: string;
}

export function serverTimezone(): ServerTimezone {
  // getTimezoneOffset 是「UTC 减本地」，取反才是习惯上的东八区为正
  const offsetMinutes = -new Date().getTimezoneOffset();
  const pad = (n: number) => String(n).padStart(2, "0");
  const abs = Math.abs(offsetMinutes);
  let name = "";
  try {
    name = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    // 运行时没有完整 ICU 时退回纯偏移，前端会用 offsetMinutes 兜底
  }
  return {
    name,
    offsetMinutes,
    label: `UTC${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
  };
}
