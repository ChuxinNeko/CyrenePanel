import { createHash, createPublicKey } from "crypto";
import {
  dbConsumeNodePairingCode,
  dbConsumeNodeRequestNonce,
  dbGetNodeController,
  dbUpsertNodeController,
} from "../db";
import {
  NODE_AUTH_MAX_CLOCK_SKEW_MS,
  NODE_AUTH_NONCE_TTL_MS,
  readNodeRequestProof,
  verifyNodeRequestProof,
  type SignableNodeRequest,
} from "./protocol";
import { logger } from "../logger/index";

export const DEFAULT_NODE_CAPABILITIES = [
  "system:read",
  "system:update",
  "instances:read",
  "instances:write",
  "files:read",
  "files:write",
  "docker:operate",
  "services:operate",
  "environments:operate",
  "databases:operate",
  "sites:operate",
  "certificates:operate",
  "audit:read",
  "appstore:deploy",
  "ai:read",
] as const;

export interface NodePrincipal {
  kind: "node";
  id: string;
  name: string;
  capabilities: string[];
}

export function hashPairingCode(code: string): string {
  return createHash("sha256").update(`cyrene-node-pairing-v2:${code}`).digest("hex");
}

export function consumeNodePairingCode(code: string): boolean {
  return dbConsumeNodePairingCode(hashPairingCode(code));
}

export function registerNodeController(input: {
  id: string;
  name: string;
  keyId: string;
  publicKeyPem: string;
  capabilities?: string[];
}): void {
  createPublicKey(input.publicKeyPem);
  dbUpsertNodeController({
    id: input.id,
    name: input.name,
    keyId: input.keyId,
    publicKeyPem: input.publicKeyPem,
    capabilities: JSON.stringify(input.capabilities ?? DEFAULT_NODE_CAPABILITIES),
    createdAt: Date.now(),
  });
}

function parseCapabilities(value: string): string[] {
  try {
    const result = JSON.parse(value);
    return Array.isArray(result) && result.every((item) => typeof item === "string")
      ? result
      : [];
  } catch {
    return [];
  }
}

export function verifySignedNodeRequest(
  request: Request,
  signable: SignableNodeRequest,
  consumeNonce = true,
): NodePrincipal | null {
  const proof = readNodeRequestProof(request.headers);
  if (!proof) {
    logger.warn(`[node-auth] 拒绝: 请求头缺失或格式错误 (${signable.method} ${signable.pathWithQuery})`);
    return null;
  }
  const skew = Date.now() - proof.timestamp;
  if (Math.abs(skew) > NODE_AUTH_MAX_CLOCK_SKEW_MS) {
    logger.warn(`[node-auth] 拒绝: 时间偏差过大 skew=${skew}ms controller=${proof.controllerId} (主/子节点时钟不同步)`);
    return null;
  }

  const controller = dbGetNodeController(proof.controllerId);
  if (!controller) {
    logger.warn(`[node-auth] 拒绝: 未找到 controller=${proof.controllerId} (主节点身份与配对时不一致/未配对/DB被重置)`);
    return null;
  }
  if (controller.revokedAt !== null) {
    logger.warn(`[node-auth] 拒绝: controller=${proof.controllerId} 已被吊销`);
    return null;
  }
  if (controller.keyId !== proof.keyId) {
    logger.warn(`[node-auth] 拒绝: keyId 不匹配 存储=${controller.keyId} 请求=${proof.keyId} (主节点重新生成了身份密钥)`);
    return null;
  }

  let publicKey;
  try {
    publicKey = createPublicKey(controller.publicKeyPem);
  } catch {
    logger.warn(`[node-auth] 拒绝: controller=${proof.controllerId} 存储的公钥无法解析`);
    return null;
  }

  if (!verifyNodeRequestProof(signable, proof, publicKey)) {
    logger.warn(`[node-auth] 拒绝: 签名验证失败 controller=${proof.controllerId} (${signable.method} ${signable.pathWithQuery}) — 路径/查询串/请求体在转发中被改写`);
    return null;
  }
  if (consumeNonce && !dbConsumeNodeRequestNonce(controller.id, proof.nonce, Date.now() + NODE_AUTH_NONCE_TTL_MS)) {
    logger.warn(`[node-auth] 拒绝: nonce 重放 controller=${proof.controllerId} nonce=${proof.nonce.slice(0, 12)}… (同一请求被验证了两次)`);
    return null;
  }

  return {
    kind: "node",
    id: controller.id,
    name: controller.name,
    capabilities: parseCapabilities(controller.capabilities),
  };
}

export function nodeCan(principal: NodePrincipal, capability: string): boolean {
  return principal.capabilities.includes(capability);
}