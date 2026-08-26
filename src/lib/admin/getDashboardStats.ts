import { createServiceSupabase } from "@/lib/supabase/server";

export const DASHBOARD_DAYS = 30;

export type DashboardUserRow = {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
};

export type DailyCountPoint = {
  date: string; // YYYY-MM-DD (JST)
  count: number;
};

export type DailyYenPoint = {
  date: string; // YYYY-MM-DD (JST)
  yen: number;
};

export type DashboardStats = {
  users: DashboardUserRow[];
  userCount: number;
  analysisCost: DailyYenPoint[];
  analysisCostTotalYen: number;
  overall: DailyCountPoint[];
  monitorCamera: DailyCountPoint[];
  pictureSave: DailyCountPoint[];
};

function formatJstDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Last `days` calendar days in JST, oldest → newest. */
export function buildJstDateKeys(days: number, now = new Date()): string[] {
  const todayKey = formatJstDate(now);
  const [y, m, d] = todayKey.split("-").map(Number);
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const utcGuess = Date.UTC(y, m - 1, d - i, 12, 0, 0);
    keys.push(formatJstDate(new Date(utcGuess)));
  }
  return keys;
}

function emptySeries(dateKeys: string[]): DailyCountPoint[] {
  return dateKeys.map((date) => ({ date, count: 0 }));
}

function bucketByJstDate(
  timestamps: string[],
  dateKeys: string[]
): DailyCountPoint[] {
  const counts = new Map(dateKeys.map((k) => [k, 0]));
  for (const ts of timestamps) {
    const key = formatJstDate(new Date(ts));
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return dateKeys.map((date) => ({ date, count: counts.get(date) ?? 0 }));
}

/** Sum estimated_cost_yen by JST calendar day. Null costs are skipped. */
export function bucketYenByJstDate(
  rows: { created_at: string; estimated_cost_yen: number | null }[],
  dateKeys: string[]
): DailyYenPoint[] {
  const sums = new Map(dateKeys.map((k) => [k, 0]));
  for (const row of rows) {
    if (row.estimated_cost_yen == null) continue;
    const key = formatJstDate(new Date(row.created_at));
    if (sums.has(key)) {
      sums.set(key, (sums.get(key) ?? 0) + row.estimated_cost_yen);
    }
  }
  return dateKeys.map((date) => ({
    date,
    yen: Math.round((sums.get(date) ?? 0) * 1000) / 1000,
  }));
}

function emptyYenSeries(dateKeys: string[]): DailyYenPoint[] {
  return dateKeys.map((date) => ({ date, yen: 0 }));
}

async function listAllUsers(
  supabase: ReturnType<typeof createServiceSupabase>
): Promise<DashboardUserRow[]> {
  const perPage = 1000;
  let page = 1;
  const users: DashboardUserRow[] = [];

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });
    if (error) throw error;

    for (const u of data.users) {
      users.push({
        id: u.id,
        email: u.email ?? "",
        createdAt: u.created_at,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }

    if (data.users.length < perPage) break;
    page += 1;
  }

  users.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  return users;
}

/**
 * Aggregates admin dashboard stats (service role).
 * Safe to call only from developer-gated server code.
 */
export async function getDashboardStats(
  days: number = DASHBOARD_DAYS
): Promise<DashboardStats> {
  const supabase = createServiceSupabase();
  const dateKeys = buildJstDateKeys(days);
  const rangeStart = `${dateKeys[0]}T00:00:00+09:00`;

  const [users, capturesRes, sendsRes, analysisRes] = await Promise.all([
    listAllUsers(supabase),
    supabase
      .from("manual_captures")
      .select("created_at")
      .gte("created_at", rangeStart),
    supabase
      .from("picture_sends")
      .select("created_at")
      .gte("created_at", rangeStart),
    supabase
      .from("image_analysis_runs")
      .select("created_at, estimated_cost_yen")
      .gte("created_at", rangeStart),
  ]);

  if (capturesRes.error) throw capturesRes.error;
  if (sendsRes.error) throw sendsRes.error;
  if (analysisRes.error) throw analysisRes.error;

  const captureTs = (capturesRes.data ?? []).map((r) => r.created_at as string);
  const sendTs = (sendsRes.data ?? []).map((r) => r.created_at as string);
  const analysisRows = (analysisRes.data ?? []).map((r) => ({
    created_at: r.created_at as string,
    estimated_cost_yen:
      r.estimated_cost_yen == null ? null : Number(r.estimated_cost_yen),
  }));

  const monitorCamera =
    captureTs.length > 0 ? bucketByJstDate(captureTs, dateKeys) : emptySeries(dateKeys);
  const pictureSave =
    sendTs.length > 0 ? bucketByJstDate(sendTs, dateKeys) : emptySeries(dateKeys);
  const overall = dateKeys.map((date, i) => ({
    date,
    count: monitorCamera[i].count + pictureSave[i].count,
  }));
  const analysisCost =
    analysisRows.length > 0
      ? bucketYenByJstDate(analysisRows, dateKeys)
      : emptyYenSeries(dateKeys);
  const analysisCostTotalYen =
    Math.round(analysisCost.reduce((sum, p) => sum + p.yen, 0) * 1000) / 1000;

  return {
    users,
    userCount: users.length,
    analysisCost,
    analysisCostTotalYen,
    overall,
    monitorCamera,
    pictureSave,
  };
}
