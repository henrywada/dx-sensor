// src/app/api/line/friend-link-accept/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseFriendLinkAcceptBody } from "./parseBody";

describe("parseFriendLinkAcceptBody", () => {
  it("parses a valid body", () => {
    const result = parseFriendLinkAcceptBody({ idToken: "abc.def.ghi", inviteToken: "tok123" });
    expect(result).toEqual({ idToken: "abc.def.ghi", inviteToken: "tok123" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseFriendLinkAcceptBody({ inviteToken: "tok123" })).toThrow();
  });

  it("rejects an empty inviteToken", () => {
    expect(() =>
      parseFriendLinkAcceptBody({ idToken: "abc.def.ghi", inviteToken: "" })
    ).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseFriendLinkAcceptBody("not an object")).toThrow();
  });
});
