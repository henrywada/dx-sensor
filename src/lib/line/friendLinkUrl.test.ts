import { describe, expect, it } from "vitest";
import { buildFriendLinkPath } from "./friendLinkUrl";

describe("buildFriendLinkPath", () => {
  it("builds a path under the LIFF friend-link page that actually exists", () => {
    expect(buildFriendLinkPath("tok123")).toBe("/liff/friend-link/tok123");
  });

  it("does not build the removed /line-friend-invite path", () => {
    expect(buildFriendLinkPath("tok123")).not.toContain("/line-friend-invite");
  });
});
