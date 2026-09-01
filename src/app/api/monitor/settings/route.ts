import { NextResponse } from "next/server";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import type { MonitorUserSettings } from "@/lib/monitor/types";
import { createServerSupabase } from "@/lib/supabase/server";

const SLOT_COUNT = 11;
/** 最後の1枠は出力フォーマット（回答の文型サンプル）専用として固定ラベルにする。 */
const OUTPUT_FORMAT_SLOT_INDEX = SLOT_COUNT - 1;

function defaultLabelFor(index: number): string {
  return index === OUTPUT_FORMAT_SLOT_INDEX ? "出力フォーマット" : `項目${index + 1}`;
}

const DEFAULT_SETTINGS: MonitorUserSettings = {
  title: "",
  email: null,
  slotLabels: Array.from({ length: SLOT_COUNT }, (_, i) => defaultLabelFor(i)),
  slotValues: Array.from({ length: SLOT_COUNT }, () => ""),
  templateId: null,
};

type SettingsRow = {
  title: string | null;
  email: string | null;
  slot_labels: unknown;
  slot_values: unknown;
  template_id: string | null;
};

function normalizeSlotStrings(value: unknown, fallback: (index: number) => string): string[] {
  const values = Array.isArray(value) ? value : [];
  return Array.from({ length: SLOT_COUNT }, (_, index) => {
    const slotValue = values[index];
    if (typeof slotValue === "string" && slotValue.trim() !== "") return slotValue;
    return fallback(index);
  });
}

function serializeSettings(row: SettingsRow | null): MonitorUserSettings {
  if (!row) {
    return DEFAULT_SETTINGS;
  }

  return {
    title: row.title ?? "",
    email: row.email,
    slotLabels: normalizeSlotStrings(row.slot_labels, (i) => defaultLabelFor(i)),
    slotValues: normalizeSlotStrings(row.slot_values, () => ""),
    templateId: row.template_id,
  };
}

function parseSettingsBody(body: unknown): MonitorUserSettings | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const { title, email, slotLabels, slotValues, templateId } = body as Record<
    string,
    unknown
  >;
  if (
    typeof title !== "string" ||
    !(email === null || typeof email === "string") ||
    !Array.isArray(slotValues) ||
    !(templateId === null || typeof templateId === "string")
  ) {
    return null;
  }

  return {
    title,
    email,
    slotLabels: Array.isArray(slotLabels)
      ? normalizeSlotStrings(slotLabels, (i) => defaultLabelFor(i))
      : DEFAULT_SETTINGS.slotLabels,
    slotValues: normalizeSlotStrings(slotValues, () => ""),
    templateId,
  };
}

export async function GET() {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("monitor_user_settings")
    .select("title, email, slot_labels, slot_values, template_id")
    .eq("user_id", viewer.userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ...DEFAULT_SETTINGS, saved: false });
  }

  return NextResponse.json({ ...serializeSettings(data), saved: true });
}

export async function PUT(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let settings: MonitorUserSettings | null;
  try {
    settings = parseSettingsBody(await req.json());
  } catch {
    settings = null;
  }

  if (!settings) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const { data, error } = await supabase
    .from("monitor_user_settings")
    .upsert({
      user_id: viewer.userId,
      title: settings.title,
      email: settings.email,
      slot_labels: settings.slotLabels,
      slot_values: settings.slotValues,
      template_id: settings.templateId,
      updated_at: new Date().toISOString(),
    })
    .select("title, email, slot_labels, slot_values, template_id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ...serializeSettings(data), saved: true });
}
