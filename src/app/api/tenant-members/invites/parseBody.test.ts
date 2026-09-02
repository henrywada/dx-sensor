import { describe, expect, it } from "vitest";
import { parseInviteBody } from "./parseBody";

const tenantId = "11111111-1111-4111-8111-111111111111";

describe("parseInviteBody", () => {
  it("parses a valid body", () => {
    const result = parseInviteBody({
      tenantId,
      inviteeEmail: "Taro.Yamada@Example.com",
      role: "viewer",
    });
    expect(result).toEqual({
      tenantId,
      inviteeEmail: "taro.yamada@example.com",
      role: "viewer",
    });
  });

  it("rejects an invalid tenantId", () => {
    expect(() =>
      parseInviteBody({ tenantId: "not-a-uuid", inviteeEmail: "a@b.com", role: "viewer" })
    ).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() =>
      parseInviteBody({ tenantId, inviteeEmail: "not-an-email", role: "viewer" })
    ).toThrow();
  });

  it("rejects a role of developer", () => {
    expect(() =>
      parseInviteBody({ tenantId, inviteeEmail: "a@b.com", role: "developer" })
    ).toThrow();
  });

  it("rejects a missing role", () => {
    expect(() => parseInviteBody({ tenantId, inviteeEmail: "a@b.com" })).toThrow();
  });
});
