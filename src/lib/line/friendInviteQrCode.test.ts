import { describe, expect, it } from "vitest";
import { buildFriendInviteLiffUrl, generateFriendInviteQrDataUrl } from "./friendInviteQrCode";

describe("buildFriendInviteLiffUrl", () => {
  it("builds a liff.line.me URL with the token as a query param", () => {
    expect(buildFriendInviteLiffUrl("1234567890-abcdEFGH", "tok_ABC123")).toBe(
      "https://liff.line.me/1234567890-abcdEFGH?t=tok_ABC123"
    );
  });

  it("URL-encodes special characters in the token", () => {
    expect(buildFriendInviteLiffUrl("liff-id", "a+b/c=")).toBe(
      "https://liff.line.me/liff-id?t=a%2Bb%2Fc%3D"
    );
  });
});

describe("generateFriendInviteQrDataUrl", () => {
  it("returns a PNG data URL", async () => {
    const dataUrl = await generateFriendInviteQrDataUrl("https://liff.line.me/x?t=y");
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  });
});
