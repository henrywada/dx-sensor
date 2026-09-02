import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyLineWebhookSignature } from "./verifyWebhookSignature";

const channelSecret = "test-channel-secret";
const rawBody = '{"events":[]}';

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

describe("verifyLineWebhookSignature", () => {
  it("returns true for a valid signature", () => {
    const signature = sign(rawBody, channelSecret);
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: signature, channelSecret })
    ).toBe(true);
  });

  it("returns false for a signature computed with the wrong secret", () => {
    const signature = sign(rawBody, "wrong-secret");
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: signature, channelSecret })
    ).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(
      verifyLineWebhookSignature({ rawBody, signatureHeader: null, channelSecret })
    ).toBe(false);
  });

  it("returns false when the body was tampered with", () => {
    const signature = sign(rawBody, channelSecret);
    expect(
      verifyLineWebhookSignature({
        rawBody: '{"events":[{"type":"follow"}]}',
        signatureHeader: signature,
        channelSecret,
      })
    ).toBe(false);
  });
});
