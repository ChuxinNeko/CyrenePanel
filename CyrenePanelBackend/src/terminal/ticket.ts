/**
 * 终端 WebSocket 一次性票据。
 *
 * 浏览器无法给 WS 握手设置 Authorization 头，历史做法是把 JWT 拼进 URL query，
 * 但 URL 会进浏览器历史、也可能被前置反代记进 access 日志——等于把长效管理员
 * 凭证四处散播。改成：先用带 Bearer 头的普通 HTTP（经前端代理）换一张短时效、
 * 一次性的票据，再拿票据开 WS。JWT 不再出现在任何 URL 里。
 *
 * 后端是单进程 systemd 服务，票据存内存即可（与登录限流表同一做法）。
 */

import { randomBytes } from "crypto";

export type TicketPurpose = "system" | "docker-exec" | "instance";

interface Ticket {
  username: string;
  role: string;
  purpose: TicketPurpose;
  expiresAt: number;
}

const tickets = new Map<string, Ticket>();

/** 票据只够浏览器拿到后立刻发起连接，20 秒足矣 */
const TTL_MS = 20_000;

function sweep(now: number): void {
  for (const [id, ticket] of tickets) {
    if (ticket.expiresAt <= now) tickets.delete(id);
  }
}

export function issueTicket(data: {
  username: string;
  role: string;
  purpose: TicketPurpose;
}): { ticket: string; expiresIn: number } {
  const now = Date.now();
  sweep(now);
  const id = randomBytes(32).toString("hex");
  tickets.set(id, { ...data, expiresAt: now + TTL_MS });
  return { ticket: id, expiresIn: Math.floor(TTL_MS / 1000) };
}

/** 取出并立即作废（一次性）。不存在、已过期或用途不符都返回 null */
export function consumeTicket(
  id: string | null | undefined,
  purpose: TicketPurpose,
): Ticket | null {
  if (!id) return null;
  const ticket = tickets.get(id);
  if (!ticket) return null;
  // 命中即删：即便后续校验不通过，这张票也不该能再用第二次
  tickets.delete(id);
  if (ticket.expiresAt <= Date.now()) return null;
  if (ticket.purpose !== purpose) return null;
  return ticket;
}
