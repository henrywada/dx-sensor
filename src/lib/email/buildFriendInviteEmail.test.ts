import { describe, expect, it } from "vitest";
import { buildFriendInviteEmail } from "./buildFriendInviteEmail";

describe("buildFriendInviteEmail", () => {
  it("includes the tenant name in the subject", () => {
    const { subject } = buildFriendInviteEmail({
      tenantName: "サンプル駐車場",
      inviteUrl: "https://example.com/liff/friend-link/tok123",
    });
    expect(subject).toContain("サンプル駐車場");
  });

  it("includes the invite URL in the html body", () => {
    const { html } = buildFriendInviteEmail({
      tenantName: "サンプル駐車場",
      inviteUrl: "https://example.com/liff/friend-link/tok123",
    });
    expect(html).toContain("https://example.com/liff/friend-link/tok123");
  });
});
