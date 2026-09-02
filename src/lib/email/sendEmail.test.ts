import { describe, expect, it, vi } from "vitest";
import { sendEmail } from "./sendEmail";

describe("sendEmail", () => {
  it("returns ok:true when the client succeeds", async () => {
    const send = vi.fn().mockResolvedValue({ data: { id: "email_1" }, error: null });

    const result = await sendEmail({
      client: { emails: { send } },
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "件名",
      html: "<p>本文</p>",
    });

    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith({
      from: "noreply@example.com",
      to: "user@example.com",
      subject: "件名",
      html: "<p>本文</p>",
    });
  });

  it("returns ok:false with the error message when the client fails", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: { message: "invalid recipient" } });

    const result = await sendEmail({
      client: { emails: { send } },
      from: "noreply@example.com",
      to: "bad-address",
      subject: "件名",
      html: "<p>本文</p>",
    });

    expect(result).toEqual({ ok: false, error: "invalid recipient" });
  });
});
