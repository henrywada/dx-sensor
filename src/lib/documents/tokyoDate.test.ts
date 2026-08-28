import { describe, expect, it } from "vitest";
import { tokyoToday } from "./tokyoDate";

describe("tokyoToday", () => {
  it("returns Tokyo calendar date for a UTC instant", () => {
    const result = tokyoToday(new Date("2026-08-27T16:00:00Z"));
    expect(result).toBe("2026-08-28");
  });
});
