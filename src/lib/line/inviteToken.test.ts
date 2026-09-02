import { describe, expect, it } from "vitest";
import { generateInviteToken, inviteExpiryDate } from "./inviteToken";

describe("generateInviteToken", () => {
  it("returns a URL-safe token of reasonable length", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(32);
  });

  it("returns a different token on each call", () => {
    const a = generateInviteToken();
    const b = generateInviteToken();
    expect(a).not.toBe(b);
  });
});

describe("inviteExpiryDate", () => {
  it("returns a date 72 hours after the given date", () => {
    const from = new Date("2026-09-02T00:00:00.000Z");
    const expiry = inviteExpiryDate(from);
    expect(expiry.toISOString()).toBe("2026-09-05T00:00:00.000Z");
  });

  it("defaults to now when no date is given", () => {
    const before = Date.now();
    const expiry = inviteExpiryDate();
    const after = Date.now();
    const seventyTwoHoursMs = 72 * 60 * 60 * 1000;
    expect(expiry.getTime()).toBeGreaterThanOrEqual(before + seventyTwoHoursMs);
    expect(expiry.getTime()).toBeLessThanOrEqual(after + seventyTwoHoursMs);
  });
});
