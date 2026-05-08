const configuredApiBase = process.env.NEXT_PUBLIC_API_URL?.trim();

export const API_BASE = configuredApiBase
  ? configuredApiBase.replace(/\/+$/, "")
  : "";

export function getApiOrigin(): string {
  if (API_BASE) return API_BASE;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getWebSocketUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (API_BASE) {
    return `${API_BASE.replace(/^http/, "ws")}${normalizedPath}`;
  }

  if (typeof window === "undefined") {
    return normalizedPath;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${normalizedPath}`;
}
