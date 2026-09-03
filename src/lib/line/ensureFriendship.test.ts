import { describe, expect, it, vi } from "vitest";
import { ensureFriendship } from "./ensureFriendship";

describe("ensureFriendship", () => {
  it("does not prompt when the user is already a friend", async () => {
    const getFriendship = vi.fn().mockResolvedValue({ friendFlag: true });
    const requestFriendship = vi.fn().mockResolvedValue(undefined);

    await ensureFriendship({ getFriendship, requestFriendship });

    expect(getFriendship).toHaveBeenCalledOnce();
    expect(requestFriendship).not.toHaveBeenCalled();
  });

  it("prompts friendship when the user is not yet a friend", async () => {
    const getFriendship = vi.fn().mockResolvedValue({ friendFlag: false });
    const requestFriendship = vi.fn().mockResolvedValue(undefined);

    await ensureFriendship({ getFriendship, requestFriendship });

    expect(requestFriendship).toHaveBeenCalledOnce();
  });

  it("swallows errors so the caller's flow is not blocked", async () => {
    const getFriendship = vi.fn().mockRejectedValue(new Error("not supported"));
    const requestFriendship = vi.fn();

    await expect(
      ensureFriendship({ getFriendship, requestFriendship })
    ).resolves.toBeUndefined();
    expect(requestFriendship).not.toHaveBeenCalled();
  });

  it("swallows errors from requestFriendship (e.g. user cancels or unsupported LIFF size)", async () => {
    const getFriendship = vi.fn().mockResolvedValue({ friendFlag: false });
    const requestFriendship = vi.fn().mockRejectedValue(new Error("unsupported size"));

    await expect(
      ensureFriendship({ getFriendship, requestFriendship })
    ).resolves.toBeUndefined();
  });
});
