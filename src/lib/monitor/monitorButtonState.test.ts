import { describe, expect, it } from "vitest";
import {
  resolveHistoryFilesButtonVisible,
  resolveStartButtonState,
} from "./monitorButtonState";

describe("resolveStartButtonState", () => {
  it("初期状態（未ロック・履歴閲覧でない）は表示・活性", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: false, historyViewMode: false })
    ).toEqual({ visible: true, disabled: false });
  });

  it("停止のみ／保存して停止の後はロックされ非活性", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: true, historyViewMode: false })
    ).toEqual({ visible: true, disabled: true });
  });

  it("履歴ファイル閲覧中は完全に非表示", () => {
    expect(
      resolveStartButtonState({ monitoringLocked: false, historyViewMode: true })
    ).toEqual({ visible: false, disabled: true });
    expect(
      resolveStartButtonState({ monitoringLocked: true, historyViewMode: true })
    ).toEqual({ visible: false, disabled: true });
  });
});

describe("resolveHistoryFilesButtonVisible", () => {
  it("監視停止中のみ表示する", () => {
    expect(resolveHistoryFilesButtonVisible(false)).toBe(true);
    expect(resolveHistoryFilesButtonVisible(true)).toBe(false);
  });
});
