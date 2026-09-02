// src/app/api/line/invite-accept/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseInviteAcceptBody } from "./parseBody";

describe("parseInviteAcceptBody", () => {
  it("parses a valid body", () => {
    const result = parseInviteAcceptBody({ idToken: "abc.def.ghi", inviteToken: "tok123" });
    expect(result).toEqual({ idToken: "abc.def.ghi", inviteToken: "tok123" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseInviteAcceptBody({ inviteToken: "tok123" })).toThrow();
  });

  it("rejects an empty inviteToken", () => {
    expect(() => parseInviteAcceptBody({ idToken: "abc.def.ghi", inviteToken: "" })).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseInviteAcceptBody("not an object")).toThrow();
  });
});
