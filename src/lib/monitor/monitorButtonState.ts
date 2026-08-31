
export type StartButtonState = {
  visible: boolean;
  disabled: boolean;
};

/**
 * 「監視の開始」ボタンの表示・活性状態を導出する。
 * 呼び出し側は `monitoring === false` のときだけこの結果を使う
 * （monitoring === true のときは常に「停止」ボタンを表示・活性で出す）。
 */
export function resolveStartButtonState(input: {
  monitoringLocked: boolean;
  historyViewMode: boolean;
}): StartButtonState {
  if (input.historyViewMode) {
    return { visible: false, disabled: true };
  }
  return { visible: true, disabled: input.monitoringLocked };
}

/**
 * 「履歴フォルダーを見る」ボタンは、監視が停止していて、かつ一時停止中でない
 * 場合のみ表示する。一時停止中（再開可能な状態）に表示すると、押した際の
 * clearCurrentEventsが再開待ちのアクティブ履歴・画像を削除してしまうため。
 */
export function resolveHistoryFilesButtonVisible(input: {
  monitoring: boolean;
  isPaused: boolean;
}): boolean {
  return !input.monitoring && !input.isPaused;
}
