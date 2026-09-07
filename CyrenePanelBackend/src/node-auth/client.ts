import { dbGetNode } from "../db";
import { getNodeIdentity } from "./identity";
import { createNodeRequestProof, nodeProofHeaders } from "./protocol";

function requestPath(endpoint: string): string {
  if (!endpoint.startsWith("/")) throw new Error("节点 endpoint 必须以 / 开头");
  return endpoint;
}

export function nodeRequestHeaders(endpoint: string, method = "GET"): Record<string, string> {
  const proof = createNodeRequestProof(
    { method, pathWithQuery: requestPath(endpoint), body: "" },
    getNodeIdentity(),
  );
  return nodeProofHeaders(proof);
}

export async function nodeFetch(
  nodeId: string,
  endpoint: string,
  init: RequestInit = {},
  timeout = 30_000,
): Promise<Response> {
  const node = dbGetNode(nodeId);
  if (!node) throw new Error("节点不存在");
  return nodeFetchAt(node.address, endpoint, init, timeout);
}

export async function nodeFetchAt(
  address: string,
  endpoint: string,
  init: RequestInit = {},
  timeout = 30_000,
): Promise<Response> {
  const pathWithQuery = requestPath(endpoint);
  const method = init.method ?? "GET";
  const body = typeof init.body === "string" ? init.body : "";
  if (init.body && typeof init.body !== "string") {
    throw new Error("节点 v2 请求 body 必须是字符串");
  }

  const proof = createNodeRequestProof(
    { method, pathWithQuery, body },
    getNodeIdentity(),
  );
  const headers = new Headers(init.headers);
  if (body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  for (const [key, value] of Object.entries(nodeProofHeaders(proof))) {
    headers.set(key, value);
  }

  return fetch(`${address.replace(/\/+$/, "")}${pathWithQuery}`, {
    ...init,
    method,
    body: init.body,
    headers,
    signal: AbortSignal.timeout(timeout),
  });
}