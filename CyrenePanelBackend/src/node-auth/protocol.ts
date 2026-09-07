import {
  createHash,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "crypto";

export const NODE_AUTH_VERSION = "v2";
export const NODE_AUTH_MAX_CLOCK_SKEW_MS = 60_000;
export const NODE_AUTH_NONCE_TTL_MS = 2 * 60_000;

export const NODE_AUTH_HEADERS = {
  version: "x-cyrene-auth-version",
  controllerId: "x-cyrene-controller-id",
  keyId: "x-cyrene-key-id",
  timestamp: "x-cyrene-timestamp",
  nonce: "x-cyrene-nonce",
  signature: "x-cyrene-signature",
} as const;

export interface NodeRequestProof {
  version: string;
  controllerId: string;
  keyId: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

export interface SignableNodeRequest {
  method: string;
  pathWithQuery: string;
  body: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePathWithQuery(value: string): string {
  if (!value.startsWith("/")) throw new Error("节点请求路径必须以 / 开头");
  return value;
}

export function createCanonicalNodeRequest(
  request: SignableNodeRequest,
  proof: Omit<NodeRequestProof, "signature">,
): string {
  return [
    NODE_AUTH_VERSION,
    proof.controllerId,
    proof.keyId,
    String(proof.timestamp),
    proof.nonce,
    request.method.toUpperCase(),
    normalizePathWithQuery(request.pathWithQuery),
    sha256(request.body),
  ].join("\n");
}

export function createNodeRequestProof(
  request: SignableNodeRequest,
  identity: { id: string; keyId: string; privateKey: KeyObject },
): NodeRequestProof {
  const proof = {
    version: NODE_AUTH_VERSION,
    controllerId: identity.id,
    keyId: identity.keyId,
    timestamp: Date.now(),
    nonce: randomBytes(24).toString("base64url"),
  };
  const payload = createCanonicalNodeRequest(request, proof);
  return {
    ...proof,
    signature: sign(null, Buffer.from(payload), identity.privateKey).toString("base64url"),
  };
}

export function readNodeRequestProof(headers: Headers): NodeRequestProof | null {
  const version = headers.get(NODE_AUTH_HEADERS.version);
  const controllerId = headers.get(NODE_AUTH_HEADERS.controllerId);
  const keyId = headers.get(NODE_AUTH_HEADERS.keyId);
  const timestamp = Number(headers.get(NODE_AUTH_HEADERS.timestamp));
  const nonce = headers.get(NODE_AUTH_HEADERS.nonce);
  const signature = headers.get(NODE_AUTH_HEADERS.signature);

  if (
    version !== NODE_AUTH_VERSION ||
    !controllerId ||
    !keyId ||
    !Number.isSafeInteger(timestamp) ||
    !nonce ||
    !signature ||
    controllerId.length > 128 ||
    keyId.length > 128 ||
    nonce.length < 16 ||
    nonce.length > 128
  ) {
    return null;
  }

  return { version, controllerId, keyId, timestamp, nonce, signature };
}

export function verifyNodeRequestProof(
  request: SignableNodeRequest,
  proof: NodeRequestProof,
  publicKey: KeyObject,
): boolean {
  const payload = createCanonicalNodeRequest(request, proof);
  try {
    return verify(null, Buffer.from(payload), publicKey, Buffer.from(proof.signature, "base64url"));
  } catch {
    return false;
  }
}

export function nodeProofHeaders(proof: NodeRequestProof): Record<string, string> {
  return {
    [NODE_AUTH_HEADERS.version]: proof.version,
    [NODE_AUTH_HEADERS.controllerId]: proof.controllerId,
    [NODE_AUTH_HEADERS.keyId]: proof.keyId,
    [NODE_AUTH_HEADERS.timestamp]: String(proof.timestamp),
    [NODE_AUTH_HEADERS.nonce]: proof.nonce,
    [NODE_AUTH_HEADERS.signature]: proof.signature,
  };
}