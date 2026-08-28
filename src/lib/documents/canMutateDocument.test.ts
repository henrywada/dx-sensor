import { describe, expect, it } from "vitest";
import { canMutateDocument } from "./canMutateDocument";

const ownerUserId = "user-owner";
const otherUserId = "user-other";

describe("canMutateDocument", () => {
  it("allows owner viewing their own document", () => {
    expect(
      canMutateDocument({
        actorUserId: ownerUserId,
        actorRole: "viewer",
        isDeveloper: false,
        ownerUserId,
        companyVisible: false,
      })
    ).toBe(true);
  });

  it("denies other viewers on a visible company document", () => {
    expect(
      canMutateDocument({
        actorUserId: otherUserId,
        actorRole: "viewer",
        isDeveloper: false,
        ownerUserId,
        companyVisible: true,
      })
    ).toBe(false);
  });

  it("allows admin to mutate visible company documents they do not own", () => {
    expect(
      canMutateDocument({
        actorUserId: otherUserId,
        actorRole: "admin",
        isDeveloper: false,
        ownerUserId,
        companyVisible: true,
      })
    ).toBe(true);
  });

  it("denies admin on non-visible company documents they do not own", () => {
    expect(
      canMutateDocument({
        actorUserId: otherUserId,
        actorRole: "admin",
        isDeveloper: false,
        ownerUserId,
        companyVisible: false,
      })
    ).toBe(false);
  });

  it("allows developers regardless of ownership or visibility", () => {
    expect(
      canMutateDocument({
        actorUserId: otherUserId,
        actorRole: "viewer",
        isDeveloper: true,
        ownerUserId,
        companyVisible: false,
      })
    ).toBe(true);
  });
});
