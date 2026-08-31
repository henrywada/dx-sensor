import { describe, expect, it, vi } from "vitest";
import {
  archiveCurrentSession,
  buildArchiveStoragePath,
  buildRestoreStoragePath,
  clearCurrentEvents,
  deleteSavedSession,
  formatSessionRangeLabel,
  planStopAction,
  restoreSessionToCurrent,
  type MonitorSessionDeps,
} from "./monitorSession";

function createDeps(overrides: Partial<MonitorSessionDeps> = {}): MonitorSessionDeps {
  return {
    generateId: vi.fn(() => "generated-id"),
    listActiveCaptures: vi.fn(async () => []),
    copyStorageObjects: vi.fn(async () => undefined),
    archiveSession: vi.fn(async () => undefined),
    listSavedSessions: vi.fn(async () => []),
    listSessionCaptures: vi.fn(async () => []),
    restoreSession: vi.fn(async () => undefined),
    deleteCurrentEvents: vi.fn(async () => []),
    deleteCaptureIfUnreferenced: vi.fn(async () => false),
    deleteSession: vi.fn(async () => undefined),
    removeStorageObjects: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("planStopAction", () => {
  it("一時停止では再開可能な状態を維持する", () => {
    expect(planStopAction("pause")).toEqual({
      shouldArchive: false,
      shouldLockStartButton: false,
    });
  });

  it("保存して終了ではアーカイブし開始ボタンをロックする", () => {
    expect(planStopAction("save_and_stop")).toEqual({
      shouldArchive: true,
      shouldLockStartButton: true,
    });
  });

  it("終了のみではアーカイブせず開始ボタンをロックする", () => {
    expect(planStopAction("stop_only")).toEqual({
      shouldArchive: false,
      shouldLockStartButton: true,
    });
  });
});

describe("formatSessionRangeLabel", () => {
  it("日付と開始〜停止時刻を含むラベルを返す", () => {
    const label = formatSessionRangeLabel({
      id: "s1",
      startedAt: "2026-08-30T08:43:14.000Z",
      stoppedAt: "2026-08-30T09:02:10.000Z",
    });
    expect(label).toMatch(/\d{2}:\d{2}:\d{2}〜\d{2}:\d{2}:\d{2}/);
    expect(label).toContain("〜");
  });
});

describe("buildArchiveStoragePath", () => {
  it("tenantId/archive/sessionId/captureId+拡張子 の形式を返す", () => {
    const path = buildArchiveStoragePath("tenant-1", "session-42", {
      captureId: "cap-1",
      storagePath: "tenant-1/2026-08-31/cap-1.jpg",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(path).toBe("tenant-1/archive/session-42/cap-1.jpg");
  });

  it("拡張子が無い場合は付けない", () => {
    const path = buildArchiveStoragePath("tenant-1", "session-42", {
      captureId: "cap-1",
      storagePath: "tenant-1/2026-08-31/cap-1",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(path).toBe("tenant-1/archive/session-42/cap-1");
  });
});

describe("buildRestoreStoragePath", () => {
  it("tenantId/restored/newCaptureId+拡張子 の形式を返す", () => {
    const path = buildRestoreStoragePath("tenant-1", "new-cap-1", {
      captureId: "cap-1",
      storagePath: "tenant-1/archive/session-42/cap-1.png",
      createdAt: "2026-08-31T00:00:00.000Z",
    });
    expect(path).toBe("tenant-1/restored/new-cap-1.png");
  });
});

describe("archiveCurrentSession", () => {
  it("アクティブな画像をアーカイブ先へコピーしてからDBへ保存する", async () => {
    const captures = [
      { captureId: "cap-1", storagePath: "tenant-1/day/cap-1.jpg", createdAt: "2026-08-30T08:00:00.000Z" },
      { captureId: "cap-2", storagePath: "tenant-1/day/cap-2.jpg", createdAt: "2026-08-30T08:05:00.000Z" },
    ];
    const deps = createDeps({
      generateId: vi.fn(() => "session-42"),
      listActiveCaptures: vi.fn(async () => captures),
    });

    const result = await archiveCurrentSession(
      {
        tenantId: "tenant-1",
        userId: "user-1",
        startedAt: "2026-08-30T08:00:00.000Z",
        stoppedAt: "2026-08-30T08:30:00.000Z",
      },
      deps
    );

    expect(deps.listActiveCaptures).toHaveBeenCalledWith({ tenantId: "tenant-1", userId: "user-1" });
    expect(deps.copyStorageObjects).toHaveBeenCalledWith([
      { fromPath: "tenant-1/day/cap-1.jpg", toPath: "tenant-1/archive/session-42/cap-1.jpg" },
      { fromPath: "tenant-1/day/cap-2.jpg", toPath: "tenant-1/archive/session-42/cap-2.jpg" },
    ]);
    expect(deps.archiveSession).toHaveBeenCalledWith({
      sessionId: "session-42",
      tenantId: "tenant-1",
      userId: "user-1",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
      captureMap: [
        { oldCaptureId: "cap-1", newCaptureId: "cap-1", newStoragePath: "tenant-1/archive/session-42/cap-1.jpg" },
        { oldCaptureId: "cap-2", newCaptureId: "cap-2", newStoragePath: "tenant-1/archive/session-42/cap-2.jpg" },
      ],
    });
    expect(result).toEqual({
      id: "session-42",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
    });
  });

  it("画像が無ければStorageコピーを呼ばない", async () => {
    const deps = createDeps({ listActiveCaptures: vi.fn(async () => []) });

    await archiveCurrentSession(
      { tenantId: "tenant-1", userId: "user-1", startedAt: "2026-08-30T08:00:00.000Z", stoppedAt: "2026-08-30T08:30:00.000Z" },
      deps
    );

    expect(deps.copyStorageObjects).not.toHaveBeenCalled();
    expect(deps.archiveSession).toHaveBeenCalled();
  });
});

describe("restoreSessionToCurrent", () => {
  it("履歴フォルダーの画像を新IDでコピーし、複製イベントとして現在に戻す", async () => {
    const captures = [
      { captureId: "cap-1", storagePath: "tenant-1/archive/session-1/cap-1.jpg", createdAt: "2026-08-30T08:00:00.000Z" },
    ];
    const generateId = vi.fn().mockReturnValueOnce("new-cap-1");
    const deps = createDeps({
      generateId,
      listSessionCaptures: vi.fn(async () => captures),
    });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.listSessionCaptures).toHaveBeenCalledWith("session-1");
    expect(deps.copyStorageObjects).toHaveBeenCalledWith([
      { fromPath: "tenant-1/archive/session-1/cap-1.jpg", toPath: "tenant-1/restored/new-cap-1.jpg" },
    ]);
    expect(deps.restoreSession).toHaveBeenCalledWith({
      sessionId: "session-1",
      tenantId: "tenant-1",
      userId: "user-1",
      captureMap: [
        { oldCaptureId: "cap-1", newCaptureId: "new-cap-1", newStoragePath: "tenant-1/restored/new-cap-1.jpg" },
      ],
    });
  });

  it("画像が無ければ何もしない", async () => {
    const deps = createDeps({ listSessionCaptures: vi.fn(async () => []) });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.copyStorageObjects).not.toHaveBeenCalled();
    expect(deps.restoreSession).not.toHaveBeenCalled();
  });
});

describe("clearCurrentEvents", () => {
  it("削除された行が参照するキャプチャを重複なく後始末する", async () => {
    const deps = createDeps({
      deleteCurrentEvents: vi.fn(async () => [
        { prevCaptureId: "cap-1", currCaptureId: "cap-2" },
        { prevCaptureId: "cap-2", currCaptureId: "cap-3" },
      ]),
    });

    await clearCurrentEvents("user-1", deps);

    expect(deps.deleteCurrentEvents).toHaveBeenCalledWith("user-1");
    expect(deps.deleteCaptureIfUnreferenced).toHaveBeenCalledTimes(3);
    const calledIds = (deps.deleteCaptureIfUnreferenced as ReturnType<typeof vi.fn>).mock.calls
      .map((call: any[]) => call[0] as string)
      .sort();
    expect(calledIds).toEqual(["cap-1", "cap-2", "cap-3"]);
  });

  it("削除対象が無ければ後始末を呼ばない", async () => {
    const deps = createDeps({ deleteCurrentEvents: vi.fn(async () => []) });

    await clearCurrentEvents("user-1", deps);

    expect(deps.deleteCaptureIfUnreferenced).not.toHaveBeenCalled();
  });
});

describe("deleteSavedSession", () => {
  it("履歴フォルダーの画像一覧を取得し、DB削除後にStorageも削除する", async () => {
    const captures = [
      { captureId: "cap-1", storagePath: "tenant-1/archive/session-1/cap-1.jpg", createdAt: "2026-08-30T08:00:00.000Z" },
      { captureId: "cap-2", storagePath: "tenant-1/archive/session-1/cap-2.jpg", createdAt: "2026-08-30T08:05:00.000Z" },
    ];
    const deps = createDeps({ listSessionCaptures: vi.fn(async () => captures) });

    await deleteSavedSession("session-1", deps);

    expect(deps.listSessionCaptures).toHaveBeenCalledWith("session-1");
    expect(deps.deleteSession).toHaveBeenCalledWith("session-1");
    expect(deps.removeStorageObjects).toHaveBeenCalledWith([
      "tenant-1/archive/session-1/cap-1.jpg",
      "tenant-1/archive/session-1/cap-2.jpg",
    ]);
  });

  it("画像が無くてもセッション自体は削除する", async () => {
    const deps = createDeps({ listSessionCaptures: vi.fn(async () => []) });

    await deleteSavedSession("session-1", deps);

    expect(deps.deleteSession).toHaveBeenCalledWith("session-1");
    expect(deps.removeStorageObjects).not.toHaveBeenCalled();
  });
});
