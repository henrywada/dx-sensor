import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyLineWebhookSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  channelSecret: string;
}): boolean {
  const { rawBody, signatureHeader, channelSecret } = params;
  if (!signatureHeader) return false;

  const expected = createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);

  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}
