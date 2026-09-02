import { describe, expect, it, vi } from "vitest";
import { establishSupabaseSession } from "./establishSupabaseSession";

describe("establishSupabaseSession", () => {
  it("calls generateLink then verifyOtp with the returned hashed_token", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-123" } },
      error: null,
    });
    const verifyOtp = vi.fn().mockResolvedValue({ error: null });

    await establishSupabaseSession({
      adminClient: { auth: { admin: { generateLink } } },
      sessionClient: { auth: { verifyOtp } },
      email: "user@example.com",
    });

    expect(generateLink).toHaveBeenCalledWith({
      type: "magiclink",
      email: "user@example.com",
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "hashed-token-123",
      email: "user@example.com",
    });
  });

  it("throws when generateLink returns an error", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });
    const verifyOtp = vi.fn();

    await expect(
      establishSupabaseSession({
        adminClient: { auth: { admin: { generateLink } } },
        sessionClient: { auth: { verifyOtp } },
        email: "user@example.com",
      })
    ).rejects.toThrow();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("throws when verifyOtp returns an error", async () => {
    const generateLink = vi.fn().mockResolvedValue({
      data: { properties: { hashed_token: "hashed-token-123" } },
      error: null,
    });
    const verifyOtp = vi.fn().mockResolvedValue({ error: { message: "boom" } });

    await expect(
      establishSupabaseSession({
        adminClient: { auth: { admin: { generateLink } } },
        sessionClient: { auth: { verifyOtp } },
        email: "user@example.com",
      })
    ).rejects.toThrow();
  });
});
