import { describe, expect, it } from "vitest";
import { parseFriendInviteBody } from "./parseBody";

describe("parseFriendInviteBody", () => {
  it("parses a valid body", () => {
    const userIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    ];
    expect(parseFriendInviteBody({ userIds })).toEqual({ userIds });
  });

  it("dedupes duplicate userIds", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseFriendInviteBody({ userIds: [id, id] })).toEqual({ userIds: [id] });
  });

  it("rejects an empty array", () => {
    expect(() => parseFriendInviteBody({ userIds: [] })).toThrow();
  });

  it("rejects a non-uuid entry", () => {
    expect(() => parseFriendInviteBody({ userIds: ["not-a-uuid"] })).toThrow();
  });

  it("rejects a missing userIds", () => {
    expect(() => parseFriendInviteBody({})).toThrow();
  });
});
