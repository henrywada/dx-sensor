import { describe, expect, it } from "vitest";
import { buildFollowReplyMessage } from "./buildFollowReplyMessage";

describe("buildFollowReplyMessage", () => {
  it("returns a single text message containing the LIFF URL", () => {
    const messages = buildFollowReplyMessage("1234567890-abcdefgh");
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe("text");
    expect(messages[0].text).toContain("https://liff.line.me/1234567890-abcdefgh");
  });
});
