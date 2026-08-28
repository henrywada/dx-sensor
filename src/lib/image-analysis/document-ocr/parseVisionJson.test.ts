import { describe, expect, it } from "vitest";
import { parseVisionJson } from "./parseVisionJson";

describe("parseVisionJson", () => {
  it("parses raw JSON", () => {
    expect(parseVisionJson('{ "front": { "full_name": "山田太郎" } }')).toEqual({
      front: { full_name: "山田太郎" },
    });
  });

  it("parses JSON wrapped in a json fence", () => {
    const text = [
      "```json",
      '{ "front": { "company": "例示商事" } }',
      "```",
    ].join("\n");

    expect(parseVisionJson(text)).toEqual({
      front: { company: "例示商事" },
    });
  });

  it("returns null for invalid text", () => {
    expect(parseVisionJson("これはJSONではありません")).toBeNull();
  });
});
