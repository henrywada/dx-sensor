import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { analyzeWithGemini } from "@/lib/image-analysis/gemini/gemini";
import { MONITOR_RESPONSE_SCHEMA } from "@/lib/monitor/buildMonitorPrompt";
import {
  type DownloadedCapture,
  type InsertMonitorChangeEventInput,
  type LogAnalysisRunInput,
  type MonitorCapture,
  MonitorTickError,
  type MonitorTickRequest,
  runMonitorTick,
  type RunMonitorTickDeps,
} from "@/lib/monitor/runMonitorTick";
import { createServerSupabase } from "@/lib/supabase/server";

const AUTO_CAPTURES_BUCKET = "auto-captures";

function parseMonitorTickRequest(body: unknown): MonitorTickRequest | null {
  if (!body || typeof body !== "object") return null;

  const { prevCaptureId, title, email, labels, slotValues } = body as Record<
    string,
    unknown
  >;
  if (
    !(prevCaptureId === null || typeof prevCaptureId === "string") ||
    typeof title !== "string" ||
    !(email === null || typeof email === "string") ||
    !Array.isArray(labels) ||
    !labels.every((label) => typeof label === "string") ||
    !Array.isArray(slotValues) ||
    !slotValues.every((value) => typeof value === "string")
  ) {
    return null;
  }

  return { prevCaptureId, title, email, labels, slotValues };
}

function toMonitorCapture(row: {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
}): MonitorCapture {
  return { id: row.id, storagePath: row.storage_path, thumbnailPath: row.thumbnail_path };
}

export async function POST(req: Request) {
  const viewer = await getViewerContext();
  if (!viewer.userId) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  const tenant = await getActiveTenant(viewer.userId);
  if (!tenant) {
    return NextResponse.json({ error: "所属テナントが見つかりません" }, { status: 403 });
  }

  let parsed: MonitorTickRequest | null;
  try {
    parsed = parseMonitorTickRequest(await req.json());
  } catch {
    parsed = null;
  }
  if (!parsed) {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const supabase = createServerSupabase();
  const deps: RunMonitorTickDeps = {
    async getNextUnprocessedCapture(excludeId) {
      let query = supabase
        .from("auto_captures")
        .select("id, storage_path, thumbnail_path")
        .eq("tenant_id", tenant.tenantId)
        .eq("captured_by", viewer.userId)
        .is("processed_at", null)
        .order("created_at", { ascending: true })
        .limit(1);

      if (excludeId) {
        query = query.neq("id", excludeId);
      }

      const { data, error } = await query.maybeSingle();

      if (error) throw new MonitorTickError(error.message, 500);
      return data ? toMonitorCapture(data) : null;
    },

    async getCaptureById(id: string) {
      const { data, error } = await supabase
        .from("auto_captures")
        .select("id, storage_path, thumbnail_path")
        .eq("id", id)
        .eq("tenant_id", tenant.tenantId)
        .eq("captured_by", viewer.userId)
        .maybeSingle();

      if (error) throw new MonitorTickError(error.message, 500);
      return data ? toMonitorCapture(data) : null;
    },

    async getCaptureOrdinal(id: string) {
      const { data: row, error: rowError } = await supabase
        .from("auto_captures")
        .select("created_at")
        .eq("id", id)
        .eq("tenant_id", tenant.tenantId)
        .eq("captured_by", viewer.userId)
        .maybeSingle();

      if (rowError) throw new MonitorTickError(rowError.message, 500);
      if (!row) return null;

      const { count, error: countError } = await supabase
        .from("auto_captures")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenant.tenantId)
        .eq("captured_by", viewer.userId)
        .lte("created_at", row.created_at);

      if (countError) throw new MonitorTickError(countError.message, 500);
      return count ?? null;
    },

    async markCaptureProcessed(id: string) {
      const { data, error } = await supabase
        .from("auto_captures")
        .update({ processed_at: new Date().toISOString() })
        .eq("id", id)
        .eq("tenant_id", tenant.tenantId)
        .eq("captured_by", viewer.userId)
        .select("id")
        .maybeSingle();

      if (error) throw new MonitorTickError(error.message, 500);
      if (!data) {
        throw new MonitorTickError(
          "画像を処理済みに更新できませんでした（権限またはマイグレーション未適用の可能性）",
          500
        );
      }
    },

    async getZones() {
      // ベストエフォート：ゾーン取得に失敗しても監視tick全体を失敗させない
      // （ゾーン未設定時は既存の全体画像解析にフォールバックする、既にサポート
      // 済みの安全な状態のため）。監視ゾーン機能を使っていないユーザーのtickまで
      // このクエリの失敗で巻き込まないようにする。
      const { data, error } = await supabase
        .from("monitor_zones")
        .select("zone_x, zone_y, zone_width, zone_height")
        .eq("tenant_id", tenant.tenantId)
        .eq("user_id", viewer.userId);

      if (error) {
        console.error("getZones failed, falling back to no zones", error);
        return [];
      }
      return (data ?? []).map((row) => ({
        x: row.zone_x as number,
        y: row.zone_y as number,
        width: row.zone_width as number,
        height: row.zone_height as number,
      }));
    },

    async downloadCapture(storagePath: string): Promise<DownloadedCapture> {
      const { data, error } = await supabase.storage
        .from(AUTO_CAPTURES_BUCKET)
        .download(storagePath);

      if (error || !data) {
        throw new MonitorTickError("画像の読み込みに失敗しました", 500);
      }

      return {
        buffer: Buffer.from(await data.arrayBuffer()),
        mimeType: data.type || "image/jpeg",
      };
    },

    async createSignedUrl(storagePath: string) {
      const { data, error } = await supabase.storage
        .from(AUTO_CAPTURES_BUCKET)
        .createSignedUrl(storagePath, 3600);

      if (error) {
        console.error("auto-captures signed URL failed", error);
        return null;
      }
      return data?.signedUrl ?? null;
    },

    analyzeImages(input) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new MonitorTickError("GEMINI_API_KEY が未設定です", 500);
      }

      return analyzeWithGemini(input, {
        apiKey,
        model: process.env.GEMINI_VISION_MODEL || "gemini-2.5-flash",
        responseSchema: MONITOR_RESPONSE_SCHEMA,
      });
    },

    async insertChangeEvent(input: InsertMonitorChangeEventInput) {
      const { data, error } = await supabase
        .from("monitor_change_events")
        .insert({
          user_id: viewer.userId,
          tenant_id: tenant.tenantId,
          prev_capture_id: input.prevCaptureId,
          curr_capture_id: input.currCaptureId,
          diff_score: input.diffScore,
          severity: input.severity,
          ai_summary: input.summary,
          email_queued: input.emailQueued,
          analysis_tool: input.analysisTool,
        })
        .select("id")
        .single();

      if (error || !data) {
        throw new MonitorTickError(error?.message ?? "監視イベントの保存に失敗しました", 500);
      }
      return data.id;
    },

    async logAnalysisRun(input: LogAnalysisRunInput) {
      const { error } = await supabase.from("image_analysis_runs").insert({
        tenant_id: tenant.tenantId,
        user_id: viewer.userId,
        capture_id: null,
        provider: input.provider,
        estimated_cost_yen: input.estimatedCostYen,
        input_tokens: input.inputTokens,
        output_tokens: input.outputTokens,
      });

      if (error) {
        console.error("image_analysis_runs insert failed", error);
      }
    },

    async deleteCaptureIfUnreferenced(captureId: string) {
      // ベストエフォート：skip（変化なし）判定で不要になった画像の間引き。
      // このcaptureIdが以降のtickでprevCaptureIdとして送られてくることは
      // 二度とないため、ここで失敗すると当該画像は削除されないまま残る
      // （自動リトライはない）。戻り値はDB行を実際に削除できたかどうかで、
      // 呼び出し元（runMonitorTick）はこれを見てレスポンスの署名URLを
      // 無効化する（削除済み画像への壊れたリンクを返さないため）。
      //
      // 「minor/notifyイベント（=Gemini解析まで進んだ判定）に参照されて
      // いなければ削除」の判定と削除本体は、DB関数
      // （delete_capture_if_unreferenced, 0022/0026マイグレーション）側で
      // 単一SQL文として実行し、アプリ側の2回のDBラウンドトリップに分けない
      // ことでレースウィンドウを縮小している。RLS(auto_captures_delete_own)
      // はこの関数内でもそのまま効く。
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "delete_capture_if_unreferenced",
          { p_capture_id: captureId }
        );

        if (rpcError) {
          console.error("deleteCaptureIfUnreferenced: rpc failed", rpcError);
          return false;
        }
        const deleted = data?.[0] as
          | { storage_path: string | null; thumbnail_path: string | null }
          | undefined;
        if (!deleted?.storage_path) return false; // minor/notifyイベントから参照されている、または既に削除済み

        // フルサイズとサムネイルの両方を削除する（サムネイルを消し忘れると
        // どのDB行からも参照されない孤立オブジェクトとしてStorageに残り続ける）。
        const paths = [deleted.storage_path, deleted.thumbnail_path].filter(
          (p): p is string => Boolean(p)
        );
        const { error: storageError } = await supabase.storage
          .from(AUTO_CAPTURES_BUCKET)
          .remove(paths);

        if (storageError) {
          console.error("deleteCaptureIfUnreferenced: storage delete failed", storageError);
        }
        return true; // DB行は削除済み（Storage削除の成否に関わらず、画像は表示できない）
      } catch (err) {
        console.error("deleteCaptureIfUnreferenced failed", err);
        return false;
      }
    },
  };

  try {
    return NextResponse.json(await runMonitorTick(parsed, deps));
  } catch (err) {
    if (err instanceof MonitorTickError) {
      return NextResponse.json({ error: err.message }, { status: err.statusCode });
    }
    const message = err instanceof Error ? err.message : "監視処理に失敗しました";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
