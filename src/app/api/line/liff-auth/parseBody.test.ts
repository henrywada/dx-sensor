// src/app/api/line/liff-auth/parseBody.test.ts
import { describe, expect, it } from "vitest";
import { parseLiffAuthBody } from "./parseBody";

describe("parseLiffAuthBody", () => {
  it("parses a valid body", () => {
    expect(parseLiffAuthBody({ idToken: "abc.def.ghi" })).toEqual({ idToken: "abc.def.ghi" });
  });

  it("rejects a missing idToken", () => {
    expect(() => parseLiffAuthBody({})).toThrow();
  });

  it("rejects a non-string idToken", () => {
    expect(() => parseLiffAuthBody({ idToken: 123 })).toThrow();
  });

  it("rejects a non-object body", () => {
    expect(() => parseLiffAuthBody(null)).toThrow();
  });
});
