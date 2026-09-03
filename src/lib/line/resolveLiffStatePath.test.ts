import { describe, expect, it } from "vitest";
import { resolveLiffStatePath } from "./resolveLiffStatePath";

describe("resolveLiffStatePath", () => {
  it("maps a bare entry state to /liff/entry", () => {
    expect(resolveLiffStatePath("/entry")).toBe("/liff/entry");
  });

  it("maps a friend-link state with token to /liff/friend-link/{token}", () => {
    expect(resolveLiffStatePath("/friend-link/skM7-i5df98rFqxTTwaRo26AEINUIpKaBexOArb")).toBe(
      "/liff/friend-link/skM7-i5df98rFqxTTwaRo26AEINUIpKaBexOArb"
    );
  });

  it("maps a bare link state to /liff/link", () => {
    expect(resolveLiffStatePath("/link")).toBe("/liff/link");
  });

  it("falls back to /liff/entry when state is null", () => {
    expect(resolveLiffStatePath(null)).toBe("/liff/entry");
  });

  it("falls back to /liff/entry when state is empty", () => {
    expect(resolveLiffStatePath("")).toBe("/liff/entry");
  });

  it("falls back to /liff/entry when state does not start with a slash", () => {
    expect(resolveLiffStatePath("entry")).toBe("/liff/entry");
  });

  it("rejects protocol-relative values to prevent open redirects", () => {
    expect(resolveLiffStatePath("//evil.com/phish")).toBe("/liff/entry");
  });

  it("rejects paths outside the known liff sub-routes", () => {
    expect(resolveLiffStatePath("/../admin")).toBe("/liff/entry");
    expect(resolveLiffStatePath("/linked-somewhere-else")).toBe("/liff/entry");
  });
});
