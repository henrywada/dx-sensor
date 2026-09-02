import { describe, expect, it } from "vitest";
import { parseWebhookEvents } from "./parseWebhookEvents";

describe("parseWebhookEvents", () => {
  it("parses a follow event", () => {
    const body = {
      events: [
        { type: "follow", replyToken: "reply-1", source: { userId: "U1" } },
      ],
    };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "follow", replyToken: "reply-1", source: { userId: "U1" } },
    ]);
  });

  it("parses an unfollow event", () => {
    const body = { events: [{ type: "unfollow", source: { userId: "U2" } }] };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "unfollow", source: { userId: "U2" } },
    ]);
  });

  it("drops events of an unknown type instead of throwing", () => {
    const body = {
      events: [
        { type: "postback", source: { userId: "U3" } },
        { type: "follow", replyToken: "reply-2", source: { userId: "U4" } },
      ],
    };
    expect(parseWebhookEvents(body)).toEqual([
      { type: "follow", replyToken: "reply-2", source: { userId: "U4" } },
    ]);
  });

  it("drops malformed events missing required fields", () => {
    const body = { events: [{ type: "follow", source: { userId: "U5" } }] };
    expect(parseWebhookEvents(body)).toEqual([]);
  });

  it("throws when the top-level body has no events array", () => {
    expect(() => parseWebhookEvents({})).toThrow();
  });
});
