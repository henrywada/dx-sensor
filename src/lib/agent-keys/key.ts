import { randomBytes, createHash } from "crypto";

const KEY_PREFIX = "dxs_agent_";

/**
 * Generates a new raw agent key (shown to the operator exactly once)
 * plus the values that get persisted to `agent_api_keys`.
 */
export function generateAgentKey() {
  const secret = randomBytes(24).toString("base64url"); // ~32 chars, URL-safe
  const rawKey = `${KEY_PREFIX}${secret}`;
  return {
    rawKey,                                  // give this to the agent device, never store it
    keyPrefix: rawKey.slice(0, 16),          // safe to store/display for identification
    keyHash: hashAgentKey(rawKey),           // store this in the DB
  };
}

export function hashAgentKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
