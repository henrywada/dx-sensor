import { describe, expect, it } from "vitest";
import { isLiffClientUserAgent } from "./isLiffClientUserAgent";

describe("isLiffClientUserAgent", () => {
  it("returns true for LINE's in-app browser user agent", () => {
    expect(
      isLiffClientUserAgent(
        "Mozilla/5.0 (Linux; Android 12; moto g52j 5G Build/...) Line/13.5.0"
      )
    ).toBe(true);
  });

  it("returns true for LINE's iOS in-app browser user agent", () => {
    expect(
      isLiffClientUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Line/13.5.0"
      )
    ).toBe(true);
  });

  it("returns false for a regular desktop browser", () => {
    expect(
      isLiffClientUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36"
      )
    ).toBe(false);
  });

  it("returns false when user agent is null", () => {
    expect(isLiffClientUserAgent(null)).toBe(false);
  });

  it("does not false-positive on unrelated strings containing 'line'", () => {
    expect(isLiffClientUserAgent("Mozilla/5.0 SomeAirline/2.0")).toBe(false);
  });
});
