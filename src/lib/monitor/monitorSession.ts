
export type StopChoice = "pause" | "save_and_stop" | "stop_only";

export type StopActionPlan = {
  shouldArchive: boolean;
  shouldLockStartButton: boolean;
};

/**
 * 停止モーダルの3択（一時停止／保存して終了／終了のみ）から、
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

/** 「日付 + 監視開始時間+停止時間」のラベルを組み立てる（履歴フォルダー一覧の表示用）。 */
export function formatSessionRangeLabel(session: MonitorSession): string {
  const start = new Date(session.startedAt);
  const stop = new Date(session.stoppedAt);
  return `${SESSION_DATE_FORMAT.format(start)} ${SESSION_TIME_FORMAT.format(
    start
  )}〜${SESSION_TIME_FORMAT.format(stop)}`;
}

export type CaptureFileRef = {
  captureId: string;
  storagePath: string;
  createdAt: string; // ISO
};

/** アーカイブ/復元時のID・パスの対応表。archiveではnewCaptureIdは元と同じ値になる。 */
export type CapturePathMapping = {
  oldCaptureId: string;
  newCaptureId: string;
  newStoragePath: string;
};

function extractExtension(storagePath: string): string {
  const dotIndex = storagePath.lastIndexOf(".");
  return dotIndex === -1 ? "" : storagePath.slice(dotIndex);
}

/**
 * アーカイブ先のStorageパスを組み立てる。sessionIdを含めることで、
 * 同じ画像を指す元パスと衝突しない決定的なパスにする
 * （途中失敗からのリトライを冪等にするため）。
 */
export function buildArchiveStoragePath(
  tenantId: string,
  sessionId: string,
  capture: CaptureFileRef
): string {
  return `${tenantId}/archive/${sessionId}/${capture.captureId}${extractExtension(capture.storagePath)}`;
}

/** 復元先のStorageパスを組み立てる。newCaptureIdは毎回新規発番されるため、
 *  同じ履歴フォルダーを繰り返し復元してもパスが衝突しない。 */
export function buildRestoreStoragePath(
  tenantId: string,
  newCaptureId: string,
  capture: CaptureFileRef
): string {
  return `${tenantId}/restored/${newCaptureId}${extractExtension(capture.storagePath)}`;
}

export type ArchiveSessionInput = {
  tenantId: string;
  userId: string;
  startedAt: string; // ISO
  stoppedAt: string; // ISO
};

export type MonitorSessionDeps = {
  /** UUID等の新規ID発番（テストでは固定値を返すモックを注入する）。 */
  generateId: () => string;

  /** 「保存して終了する」: アクティブな画像・アーカイブ用RPC呼び出し。 */
  listActiveCaptures: (input: { tenantId: string; userId: string }) => Promise<CaptureFileRef[]>;
  copyStorageObjects: (mappings: Array<{ fromPath: string; toPath: string }>) => Promise<void>;
  archiveSession: (input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    startedAt: string;
    stoppedAt: string;
    captureMap: CapturePathMapping[];
  }) => Promise<void>;

  /** 「履歴フォルダーを見る」一覧・復元。 */
  listSavedSessions: (userId: string) => Promise<MonitorSession[]>;
  listSessionCaptures: (sessionId: string) => Promise<CaptureFileRef[]>;
  restoreSession: (input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    captureMap: CapturePathMapping[];
  }) => Promise<void>;

  /** 「履歴フォルダーを見る」実行前に、現在（未アーカイブ）のイベント・画像を削除する。 */
  deleteCurrentEvents: (
    userId: string
  ) => Promise<Array<{ prevCaptureId: string; currCaptureId: string }>>;
  deleteCaptureIfUnreferenced: (captureId: string) => Promise<boolean>;

  /** 履歴フォルダー本体の削除。DB側の外部キーはCASCADE設定のため、
   *  紐づくmonitor_session_events/monitor_session_captures行も同時に削除される。 */
  deleteSession: (sessionId: string) => Promise<void>;
  removeStorageObjects: (paths: string[]) => Promise<void>;
};

/**
 * 「アクティブ履歴・画像を履歴フォルダーに保存して終了する」:
 * アクティブな画像をアーカイブ先Storageパスへ複製してから、
 * DB側（archive_current_session RPC）へまとめて保存する。
 */
export async function archiveCurrentSession(
  input: ArchiveSessionInput,
  deps: MonitorSessionDeps
): Promise<MonitorSession> {
  const sessionId = deps.generateId();
  const captures = await deps.listActiveCaptures({
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const captureMap: CapturePathMapping[] = captures.map((capture) => ({
    oldCaptureId: capture.captureId,
    newCaptureId: capture.captureId,
    newStoragePath: buildArchiveStoragePath(input.tenantId, sessionId, capture),
  }));

  if (captureMap.length > 0) {
    await deps.copyStorageObjects(
      captureMap.map((mapping, index) => ({
        fromPath: captures[index].storagePath,
        toPath: mapping.newStoragePath,
      }))
    );
  }

  await deps.archiveSession({
    sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    startedAt: input.startedAt,
    stoppedAt: input.stoppedAt,
    captureMap,
  });

  return { id: sessionId, startedAt: input.startedAt, stoppedAt: input.stoppedAt };
}

/** 「履歴フォルダーを見る」実行前に、現在（未アーカイブ）のイベント・画像を削除する。 */
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
 * 履歴フォルダー（セッション）を削除する。画像は当該フォルダー専用の複製であり
 * 他から参照されることが無いため、間引き判定なしで無条件にStorageも削除してよい。
 */
export async function deleteSavedSession(
  sessionId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const captures = await deps.listSessionCaptures(sessionId);
  await deps.deleteSession(sessionId);
  if (captures.length > 0) {
    await deps.removeStorageObjects(captures.map((capture) => capture.storagePath));
  }
}

/**
 * 選択された履歴フォルダー（アーカイブ済みセッション）の画像・イベントを、
 * 新IDでStorage・DBともに複製して「現在（アクティブ）」に戻す。
 * 履歴フォルダー側のデータは変更せず、何度でも復元できる状態を保つ。
 */
export async function restoreSessionToCurrent(
  sessionId: string,
  tenantId: string,
  userId: string,
  deps: MonitorSessionDeps
): Promise<void> {
  const captures = await deps.listSessionCaptures(sessionId);
  if (captures.length === 0) return;

  const captureMap: CapturePathMapping[] = captures.map((capture) => {
    const newCaptureId = deps.generateId();
    return {
      oldCaptureId: capture.captureId,
      newCaptureId,
      newStoragePath: buildRestoreStoragePath(tenantId, newCaptureId, capture),
    };
  });

  await deps.copyStorageObjects(
    captureMap.map((mapping, index) => ({
      fromPath: captures[index].storagePath,
      toPath: mapping.newStoragePath,
    }))
  );

  await deps.restoreSession({ sessionId, tenantId, userId, captureMap });
}
