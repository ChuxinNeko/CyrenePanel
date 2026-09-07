const nodeCapabilityForPath = (pathname: string, method: string): string | null => {
  if (pathname.startsWith("/api/instances")) return method === "GET" ? "instances:read" : "instances:write";
  if (pathname.startsWith("/api/files")) return method === "GET" ? "files:read" : "files:write";
  if (pathname.startsWith("/api/docker")) return "docker:operate";
  if (pathname.startsWith("/api/services")) return "services:operate";
  if (pathname.startsWith("/api/environments")) return "environments:operate";
  if (pathname.startsWith("/api/databases")) return "databases:operate";
  if (pathname.startsWith("/api/sites")) return "sites:operate";
  if (pathname.startsWith("/api/certificates")) return "certificates:operate";
  if (pathname.startsWith("/api/audit")) return "audit:read";
  if (pathname.startsWith("/api/appstore")) return "appstore:deploy";
  if (pathname.startsWith("/api/ai")) return "ai:read";
  if (pathname.startsWith("/api/self-check")) return method === "GET" ? "environments:operate" : "environments:operate";
  if (pathname.startsWith("/api/mysql") || pathname.startsWith("/api/databases")) return "databases:operate";
  if (pathname.startsWith("/api/system")) return method === "GET" ? "system:read" : "system:update";
  return null;
};

export const isNodeAuthEndpoint = (pathname: string): boolean => pathname.startsWith("/api/node-auth/v2/");

export const requiredNodeCapability = (request: Request): string | null => {
  const url = new URL(request.url);
  return nodeCapabilityForPath(url.pathname, request.method);
};