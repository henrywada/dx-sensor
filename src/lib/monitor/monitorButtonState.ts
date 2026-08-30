
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

/** 「履歴ファイルを見る」ボタンは監視が停止している状態でのみ表示する。 */
export function resolveHistoryFilesButtonVisible(monitoring: boolean): boolean {
  return !monitoring;
}
