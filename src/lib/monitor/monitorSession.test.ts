import { describe, expect, it, vi } from "vitest";
import {
  archiveCurrentSession,
  clearCurrentEvents,
  formatSessionRangeLabel,
  planStopAction,
  restoreSessionToCurrent,
  type MonitorSessionDeps,
} from "./monitorSession";

function createDeps(overrides: Partial<MonitorSessionDeps> = {}): MonitorSessionDeps {
  return {
    createSession: vi.fn(async () => ({ id: "session-1" })),
    tagCurrentEventsToSession: vi.fn(async () => undefined),
    listSavedSessions: vi.fn(async () => []),
    fetchSessionEvents: vi.fn(async () => []),
    insertCurrentEvents: vi.fn(async () => undefined),
    deleteCurrentEvents: vi.fn(async () => []),
    deleteCaptureIfUnreferenced: vi.fn(async () => false),
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

  it("保存して停止ではアーカイブし開始ボタンをロックする", () => {
    expect(planStopAction("save_and_stop")).toEqual({
      shouldArchive: true,
      shouldLockStartButton: true,
    });
  });

  it("停止のみではアーカイブせず開始ボタンをロックする", () => {
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

describe("archiveCurrentSession", () => {
  it("セッションを作成し、その時間帯の現在イベントをタグ付けする", async () => {
    const deps = createDeps({
      createSession: vi.fn(async () => ({ id: "session-42" })),
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

    expect(deps.createSession).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
    });
    expect(deps.tagCurrentEventsToSession).toHaveBeenCalledWith({
      userId: "user-1",
      sessionId: "session-42",
      startedAt: "2026-08-30T08:00:00.000Z",
      stoppedAt: "2026-08-30T08:30:00.000Z",
    });
    expect(result.id).toBe("session-42");
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

describe("restoreSessionToCurrent", () => {
  it("アーカイブ済みイベントを現在イベントとして複製する", async () => {
    const rows = [
      {
        prevCaptureId: "cap-1",
        currCaptureId: "cap-2",
        diffScore: 0.1,
        severity: "notify" as const,
        aiSummary: "変化を検知",
        emailQueued: true,
        analysisTool: "sharp+SSIM+pixelmatch",
        createdAt: "2026-08-30T08:10:00.000Z",
      },
    ];
    const deps = createDeps({ fetchSessionEvents: vi.fn(async () => rows) });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.fetchSessionEvents).toHaveBeenCalledWith("session-1");
    expect(deps.insertCurrentEvents).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      userId: "user-1",
      rows,
    });
  });

  it("イベントが無ければ挿入しない", async () => {
    const deps = createDeps({ fetchSessionEvents: vi.fn(async () => []) });

    await restoreSessionToCurrent("session-1", "tenant-1", "user-1", deps);

    expect(deps.insertCurrentEvents).not.toHaveBeenCalled();
  });
});
