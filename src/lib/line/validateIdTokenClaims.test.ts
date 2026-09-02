import { describe, expect, it } from "vitest";
import { validateLineIdTokenClaims } from "./validateIdTokenClaims";

const channelId = "1234567890";
const nowSeconds = 1_800_000_000;

function baseClaims() {
  return {
    sub: "U1234567890abcdef1234567890abcdef",
    aud: channelId,
    iss: "https://access.line.me",
    exp: nowSeconds + 3600,
  };
}

describe("validateLineIdTokenClaims", () => {
  it("returns the LINE user id for valid claims", () => {
    const result = validateLineIdTokenClaims(baseClaims(), { channelId, nowSeconds });
    expect(result).toEqual({ lineUserId: "U1234567890abcdef1234567890abcdef" });
  });

  it("rejects a wrong issuer", () => {
    const claims = { ...baseClaims(), iss: "https://evil.example.com" };
    expect(() => validateLineIdTokenClaims(claims, { channelId, nowSeconds })).toThrow();
  });

  it("rejects a wrong audience", () => {
    const claims = { ...baseClaims(), aud: "some-other-channel" };
    expect(() => validateLineIdTokenClaims(claims, { channelId, nowSeconds })).toThrow();
  });

  it("rejects an expired token", () => {
    const claims = { ...baseClaims(), exp: nowSeconds - 1 };
    expect(() => validateLineIdTokenClaims(claims, { channelId, nowSeconds })).toThrow();
  });

  it("rejects an empty subject", () => {
    const claims = { ...baseClaims(), sub: "" };
    expect(() => validateLineIdTokenClaims(claims, { channelId, nowSeconds })).toThrow();
  });
});
