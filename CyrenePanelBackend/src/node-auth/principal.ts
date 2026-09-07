import type { SignableNodeRequest } from "./protocol";
import { NODE_AUTH_HEADERS } from "./protocol";
import { verifySignedNodeRequest, type NodePrincipal } from "./verifier";

const resolvedPrincipals = new WeakMap<Request, NodePrincipal | null>();
const rawBodies = new WeakMap<Request, Promise<string>>();

// 在 Elysia 的 onRequest 钩子里调用（此时请求体尚未被 body parser 消费）。
// 节点签名需要校验原始请求体字节，但 Elysia 在 parse 阶段会消费掉 request 流，
// 之后再 request.clone() 会抛 "Body already used"（返回 HTTP 500）。因此在最早的
// 时机克隆并缓存原始请求体，供后续签名校验复用。
export function captureNodeRequestBody(request: Request): void {
  if (request.method === "GET" || request.method === "HEAD") return;
  if (!request.headers.has(NODE_AUTH_HEADERS.version)) return;
  if (rawBodies.has(request)) return;
  rawBodies.set(request, request.clone().text().catch(() => ""));
}

async function readSignedBody(request: Request): Promise<string> {
  if (request.method === "GET" || request.method === "HEAD") return "";
  const cached = rawBodies.get(request);
  if (cached !== undefined) return cached;
  // 回退：请求体尚未被消费时（如非 Elysia 环境的直接调用）仍可克隆读取。
  try {
    return await request.clone().text();
  } catch {
    return "";
  }
}

export async function resolveNodePrincipal(
  request: Request,
  options: { consumeNonce?: boolean } = {},
): Promise<NodePrincipal | null> {
  const consumeNonce = options.consumeNonce ?? true;
  const cached = resolvedPrincipals.get(request);
  if (consumeNonce && cached !== undefined) return cached;
  if (!request.headers.has(NODE_AUTH_HEADERS.version)) {
    if (consumeNonce) resolvedPrincipals.set(request, null);
    return null;
  }

  const url = new URL(request.url);
  const body = await readSignedBody(request);

  const signable: SignableNodeRequest = {
    method: request.method,
    pathWithQuery: `${url.pathname}${url.search}`,
    body,
  };
  const principal = verifySignedNodeRequest(request, signable, consumeNonce);
  if (consumeNonce) resolvedPrincipals.set(request, principal);
  return principal;
}

export function nodeProfile(principal: NodePrincipal | null) {
  if (!principal) return null;
  return {
    username: `node:${principal.id}`,
    role: "node",
    capabilities: principal.capabilities,
    nodeControllerId: principal.id,
  };
}

export function hasNodeCapability(profile: any, capability: string): boolean {
  return profile?.role === "node" && Array.isArray(profile.capabilities)
    ? profile.capabilities.includes(capability)
    : false;
}