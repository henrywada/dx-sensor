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
  it("監視停止中かつ一時停止中でなければ表示する", () => {
    expect(
      resolveHistoryFilesButtonVisible({ monitoring: false, isPaused: false })
    ).toBe(true);
  });

  it("監視中は非表示", () => {
    expect(
      resolveHistoryFilesButtonVisible({ monitoring: true, isPaused: false })
    ).toBe(false);
  });

  it("一時停止中（再開可能な状態）は非表示にする", () => {
    // 「履歴フォルダーを見る」を押すとclearCurrentEventsが現在のアクティブ履歴・画像を
    // 削除してしまうため、再開待ちの一時停止データを不意に失わせないよう隠す。
    expect(
      resolveHistoryFilesButtonVisible({ monitoring: false, isPaused: true })
    ).toBe(false);
  });
});
