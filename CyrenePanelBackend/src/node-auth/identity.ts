import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  type KeyObject,
} from "crypto";
import { getConfig, setConfig } from "../db";
import { logger } from "../logger/index";

const IDENTITY_CONFIG_KEY = "node_auth_identity_v2";

export interface NodeIdentity {
  id: string;
  name: string;
  keyId: string;
  privateKey: KeyObject;
  publicKeyPem: string;
}

interface StoredNodeIdentity {
  id: string;
  name: string;
  keyId: string;
  privateKeyPem: string;
}

function keyFingerprint(publicKeyPem: string): string {
  return createHash("sha256").update(publicKeyPem).digest("hex").slice(0, 16);
}

function createStoredIdentity(): StoredNodeIdentity {
  const pair = generateKeyPairSync("ed25519");
  const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    id: `node-${randomUUID()}`,
    name: process.env.CYRENE_NODE_NAME || "Cyrene 节点",
    keyId: keyFingerprint(publicKeyPem),
    privateKeyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
}

function parseStoredIdentity(raw: string): StoredNodeIdentity | null {
  try {
    const value = JSON.parse(raw) as StoredNodeIdentity;
    if (!value.id || !value.name || !value.keyId || !value.privateKeyPem) return null;
    return value;
  } catch {
    return null;
  }
}

export function getNodeIdentity(): NodeIdentity {
  const existing = getConfig(IDENTITY_CONFIG_KEY);
  const stored = existing ? parseStoredIdentity(existing) : null;
  const identity = stored ?? createStoredIdentity();

  if (!stored) {
    setConfig(IDENTITY_CONFIG_KEY, JSON.stringify(identity));
    logger.warn(
      `[node-auth] 生成了新的主节点身份 id=${identity.id} keyId=${identity.keyId} ` +
      `(若此日志出现在配对成功之后, 说明身份/DATA_DIR 发生了变化, 已配对的子节点会全部失效)`,
    );
  }

  const privateKey = createPrivateKey(identity.privateKeyPem);
  const publicKeyPem = createPublicKey(identity.privateKeyPem)
    .export({ type: "spki", format: "pem" })
    .toString();

  return {
    id: identity.id,
    name: identity.name,
    keyId: identity.keyId,
    privateKey,
    publicKeyPem,
  };
}

export function getNodePublicIdentity() {
  const identity = getNodeIdentity();
  return {
    id: identity.id,
    name: identity.name,
    keyId: identity.keyId,
    publicKeyPem: identity.publicKeyPem,
  };
}