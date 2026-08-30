
export type StopChoice = "pause" | "save_and_stop" | "stop_only";

export type StopActionPlan = {
  shouldArchive: boolean;
  shouldLockStartButton: boolean;
};

/**
 * 停止モーダルの3択（一時停止／保存して停止／停止のみ）から、
 * アーカイブ要否と「監視の開始」ボタンのロック要否を導出する。
 */
export function planStopAction(choice: StopChoice): StopActionPlan {
  switch (choice) {
    case "pause":
      return { shouldArchive: false, shouldLockStartButton: false };
    case "save_and_stop":
      return { shouldArchive: true, shouldLockStartButton: true };
    case "stop_only":
      return { shouldArchive: false, shouldLockStartButton: true };
  }
}

export type MonitorSession = {
  id: string;
  startedAt: string; // ISO
  stoppedAt: string; // ISO
};

const SESSION_DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const SESSION_TIME_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** 「日付 + 監視開始時間+停止時間」のラベルを組み立てる（履歴ファイル一覧の表示用）。 */
export function formatSessionRangeLabel(session: MonitorSession): string {
  const start = new Date(session.startedAt);
  const stop = new Date(session.stoppedAt);
  return `${SESSION_DATE_FORMAT.format(start)} ${SESSION_TIME_FORMAT.format(
    start
  )}〜${SESSION_TIME_FORMAT.format(stop)}`;
}

export type ArchivedEventRow = {
  prevCaptureId: string;
  currCaptureId: string;
  diffScore: number;
  severity: "skip" | "minor" | "notify";
  aiSummary: string | null;
  emailQueued: boolean;
  analysisTool: string | null;
  createdAt: string; // ISO
};

export type ArchiveSessionInput = {
  tenantId: string;
  userId: string;
  startedAt: string; // ISO
  stoppedAt: string; // ISO
};

export type MonitorSessionDeps = {
  createSession: (input: ArchiveSessionInput) => Promise<{ id: string }>;
  tagCurrentEventsToSession: (input: {
    userId: string;
    sessionId: string;
    startedAt: string;
    stoppedAt: string;
  }) => Promise<void>;
  listSavedSessions: (userId: string) => Promise<MonitorSession[]>;
  fetchSessionEvents: (sessionId: string) => Promise<ArchivedEventRow[]>;
  insertCurrentEvents: (input: {
    tenantId: string;
    userId: string;
    rows: ArchivedEventRow[];
  }) => Promise<void>;
  /** 「現在」（session_id無し）のイベントを削除し、削除した行が参照していたキャプチャIDを返す。 */
  deleteCurrentEvents: (
    userId: string
  ) => Promise<Array<{ prevCaptureId: string; currCaptureId: string }>>;
  deleteCaptureIfUnreferenced: (captureId: string) => Promise<boolean>;
  /** 履歴ファイル（セッション）本体を削除する。DB側の外部キーはCASCADE設定のため、
   *  紐づくmonitor_change_events行も同時に削除される。 */
  deleteSession: (sessionId: string) => Promise<void>;
};

/** 「イベント履歴・画像を保存して停止する」: 新規セッション行を作り、現在イベントをタグ付けする。 */
export async function archiveCurrentSession(
  input: ArchiveSessionInput,
  deps: MonitorSessionDeps
): Promise<MonitorSession> {
  const session = await deps.createSession(input);
  await deps.tagCurrentEventsToSession({
    userId: input.userId,
    sessionId: session.id,
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
  });
  return { id: session.id, startedAt: input.startedAt, stoppedAt: input.stoppedAt };
}

/** 「履歴ファイルを見る」実行前に、現在（未アーカイブ）のイベント・画像を削除する。 */
export async function clearCurrentEvents(
  userId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const deletedRows = await deps.deleteCurrentEvents(userId);
  const captureIds = new Set<string>();
  for (const row of deletedRows) {
    captureIds.add(row.prevCaptureId);
    captureIds.add(row.currCaptureId);
  }
  await Promise.all(
    Array.from(captureIds).map((id) => deps.deleteCaptureIfUnreferenced(id))
  );
}

/**
 * 履歴ファイル（セッション）を削除する。セッションが参照していたキャプチャIDは
 * DB側のCASCADE削除でイベント行ごと消える前に取得しておき、削除後に
 * 参照されなくなったキャプチャ（画像）を後始末する。
 */
export async function deleteSavedSession(
  sessionId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const rows = await deps.fetchSessionEvents(sessionId);
  await deps.deleteSession(sessionId);

  const captureIds = new Set<string>();
  for (const row of rows) {
    captureIds.add(row.prevCaptureId);
    captureIds.add(row.currCaptureId);
  }
  await Promise.all(
    Array.from(captureIds).map((id) => deps.deleteCaptureIfUnreferenced(id))
  );
}

/** 選択された履歴ファイル（アーカイブ済みセッション）のイベントを「現在」として複製する。 */
export async function restoreSessionToCurrent(
  sessionId: string,
  tenantId: string,
  userId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const rows = await deps.fetchSessionEvents(sessionId);
  if (rows.length === 0) return;
  await deps.insertCurrentEvents({ tenantId, userId, rows });
}
