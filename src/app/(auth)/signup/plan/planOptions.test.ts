import { describe, expect, it } from "vitest";
import { PLAN_OPTIONS } from "./planOptions";

describe("PLAN_OPTIONS", () => {
  it("makes the free plan selectable, linking straight to /signup", () => {
    const free = PLAN_OPTIONS.find((plan) => plan.id === "free");
    expect(free?.href).toBe("/signup");
    expect(free?.badge).toBeUndefined();
  });

  it("keeps the premium plan disabled (no href) until Stripe billing ships", () => {
    const premium = PLAN_OPTIONS.find((plan) => plan.id === "premium");
    expect(premium?.href).toBeUndefined();
    expect(premium?.badge).toBe("近日公開");
  });
});
