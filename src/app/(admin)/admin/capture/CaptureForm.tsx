"use client";

import Link from "next/link";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface CaptureFormProps {
  tenantId: string;
  userId: string;
}

type Status = "idle" | "uploading" | "done" | "error";

export function CaptureForm({ tenantId, userId }: CaptureFormProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const supabase = createClient();

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("uploading");
    setErrorMessage(null);

    try {
      const dateSegment = new Date().toISOString().slice(0, 10);
      const path = `${tenantId}/${dateSegment}/${crypto.randomUUID()}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("manual-captures")
        .upload(path, file, { contentType: file.type || "image/jpeg" });

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from("manual_captures")
        .insert({
          tenant_id: tenantId,
          captured_by: userId,
          storage_path: path,
        });

      if (insertError) throw insertError;

      setStatus("done");
    } catch (err) {
      console.error("manual capture upload failed", err);
      setErrorMessage(
        err instanceof Error ? err.message : "アップロードに失敗しました"
      );
      setStatus("error");
    } finally {
      // 同じファイルを連続で選択できるよう input をリセット
      e.target.value = "";
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-ink">写真を撮影</h1>
        <Link
          href="/admin"
          className="shrink-0 text-sm font-medium text-signal transition-colors hover:text-ink"
        >
          ←戻る
        </Link>
      </div>
      <p className="text-sm text-ink/70">
        カメラを起動して1枚撮影すると、自動的にアップロードされます。
      </p>

      <label
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-signal/40 bg-paper px-6 py-10 text-center text-signal transition hover:border-signal"
        aria-disabled={status === "uploading"}
      >
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleFile}
          disabled={status === "uploading"}
          className="hidden"
        />
        <span className="text-sm font-medium">
          {status === "uploading" ? "アップロード中..." : "タップして撮影"}
        </span>
      </label>

      {status === "done" && (
        <p className="rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
          アップロードが完了しました。
        </p>
      )}

      {status === "error" && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">
          {errorMessage ?? "エラーが発生しました。もう一度お試しください。"}
        </p>
      )}
    </div>
  );
}
