import { NextResponse } from "next/server";
import { getActiveTenant } from "@/lib/auth/getActiveTenant";
import { getViewerContext } from "@/lib/auth/getViewerContext";
import { analyzeWithGemini } from "@/lib/image-analysis/gemini/gemini";
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

function toMonitorCapture(row: { id: string; storage_path: string }): MonitorCapture {
  return { id: row.id, storagePath: row.storage_path };
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
        .select("id, storage_path")
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
        .select("id, storage_path")
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
      // ベストエフォート：skip/minor判定で不要になった画像の間引き。
      // このcaptureIdが以降のtickでprevCaptureIdとして送られてくることは
      // 二度とないため、ここで失敗すると当該画像は削除されないまま残る
      // （自動リトライはない）。
      //
      // 「notifyイベントに参照されていなければ削除」の判定と削除本体は
      // DB関数（delete_capture_if_unreferenced, 0022マイグレーション）側で
      // 単一SQL文として実行し、アプリ側の2回のDBラウンドトリップに分けない
      // ことでレースウィンドウを縮小している。RLS(auto_captures_delete_own)
      // はこの関数内でもそのまま効く。
      try {
        const { data: storagePath, error: rpcError } = await supabase.rpc(
          "delete_capture_if_unreferenced",
          { p_capture_id: captureId }
        );

        if (rpcError) {
          console.error("deleteCaptureIfUnreferenced: rpc failed", rpcError);
          return;
        }
        if (!storagePath) return; // notify証拠として参照されている、または既に削除済み

        const { error: storageError } = await supabase.storage
          .from(AUTO_CAPTURES_BUCKET)
          .remove([storagePath]);

        if (storageError) {
          console.error("deleteCaptureIfUnreferenced: storage delete failed", storageError);
        }
      } catch (err) {
        console.error("deleteCaptureIfUnreferenced failed", err);
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
