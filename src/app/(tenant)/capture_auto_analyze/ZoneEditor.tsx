"use client";

import { X } from "lucide-react";
import type { PointerEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isZoneLargeEnough,
  pointFromClientOffset,
  rectFromDrag,
  type ZoneDragPoint,
  type ZoneRect,
} from "@/lib/monitor/monitorZones";

type ZoneEditorProps = {
  tenantId: string;
  userId: string;
};

type EditableZone = ZoneRect & { localId: string };

type BasePhoto = {
  id: string;
  signedUrl: string | null;
};

export function ZoneEditor({ tenantId, userId }: ZoneEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const containerRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [basePhoto, setBasePhoto] = useState<BasePhoto | null>(null);
  const [zones, setZones] = useState<EditableZone[]>([]);
  const [draft, setDraft] = useState<{ start: ZoneDragPoint; current: ZoneDragPoint } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const { data: photoRow, error: photoError } = await supabase
          .from("monitor_base_photos")
          .select("id, storage_path")
          .eq("tenant_id", tenantId)
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (photoError) throw photoError;
        if (cancelled) return;

        if (!photoRow) {
          setBasePhoto(null);
          setZones([]);
          return;
        }

        const [{ data: signed }, { data: zoneRows, error: zonesError }] = await Promise.all([
          supabase.storage.from("auto-captures").createSignedUrl(photoRow.storage_path, 3600),
          supabase
            .from("monitor_zones")
            .select("zone_x, zone_y, zone_width, zone_height")
            .eq("base_photo_id", photoRow.id),
        ]);
        if (zonesError) throw zonesError;
        if (cancelled) return;

        setBasePhoto({ id: photoRow.id, signedUrl: signed?.signedUrl ?? null });
        setZones(
          (zoneRows ?? []).map((row) => ({
            localId: crypto.randomUUID(),
            x: row.zone_x as number,
            y: row.zone_y as number,
            width: row.zone_width as number,
            height: row.zone_height as number,
          }))
        );
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "基本写真の読み込みに失敗しました");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId, userId]);

  const handlePointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const point = pointFromClientOffset(e.clientX, e.clientY, rect);
    setDraft({ start: point, current: point });
  }, []);

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!draft) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const point = pointFromClientOffset(e.clientX, e.clientY, rect);
      setDraft({ start: draft.start, current: point });
    },
    [draft]
  );

  const handlePointerUp = useCallback(() => {
    if (!draft) return;
    const rect = rectFromDrag(draft.start, draft.current);
    if (isZoneLargeEnough(rect)) {
      setZones((prev) => [...prev, { localId: crypto.randomUUID(), ...rect }]);
    }
    setDraft(null);
  }, [draft]);

  const handleRemoveZone = useCallback((localId: string) => {
    setZones((prev) => prev.filter((zone) => zone.localId !== localId));
  }, []);

  const handleSave = useCallback(async () => {
    if (!basePhoto) return;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const { error: deleteError } = await supabase
        .from("monitor_zones")
        .delete()
        .eq("base_photo_id", basePhoto.id);
      if (deleteError) throw deleteError;

      if (zones.length > 0) {
        const { error: insertError } = await supabase.from("monitor_zones").insert(
          zones.map((zone) => ({
            tenant_id: tenantId,
            user_id: userId,
            base_photo_id: basePhoto.id,
            zone_x: zone.x,
            zone_y: zone.y,
            zone_width: zone.width,
            zone_height: zone.height,
          }))
        );
        if (insertError) throw insertError;
      }

      setSaveMessage("監視ゾーンを保存しました");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }, [supabase, tenantId, userId, basePhoto, zones]);

  const draftRect = draft ? rectFromDrag(draft.start, draft.current) : null;

  if (loading) {
    return <p className="text-sm text-ink-soft">読み込み中...</p>;
  }

  if (loadError) {
    return <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{loadError}</p>;
  }

  if (!basePhoto || !basePhoto.signedUrl) {
    return (
      <p className="text-sm text-ink-soft">
        基本写真がありません。「固定撮影」画面の「基本写真を撮る」から登録してください。
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-soft">
        基本写真の上をドラッグして、変化を検知したい範囲（監視ゾーン）を囲んでください。複数指定できます。
      </p>

      <div
        ref={containerRef}
        className="relative touch-none select-none overflow-hidden rounded-md border border-line"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- 署名URLは一時的なものでnext/imageの最適化対象にしない */}
        <img
          src={basePhoto.signedUrl}
          alt="基本写真"
          className="block w-full"
          draggable={false}
        />
        {zones.map((zone) => (
          <div
            key={zone.localId}
            className="absolute border-2 border-signal bg-signal/10"
            style={{
              left: `${zone.x * 100}%`,
              top: `${zone.y * 100}%`,
              width: `${zone.width * 100}%`,
              height: `${zone.height * 100}%`,
            }}
          >
            <button
              type="button"
              onClick={() => handleRemoveZone(zone.localId)}
              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-alert text-white"
              aria-label="この監視ゾーンを削除"
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        ))}
        {draftRect && (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-signal/70"
            style={{
              left: `${draftRect.x * 100}%`,
              top: `${draftRect.y * 100}%`,
              width: `${draftRect.width * 100}%`,
              height: `${draftRect.height * 100}%`,
            }}
          />
        )}
      </div>

      {saveMessage && (
        <p className="rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">{saveMessage}</p>
      )}
      {saveError && (
        <p className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{saveError}</p>
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs text-ink-soft">監視ゾーン: {zones.length}件</p>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={saving}
          className="rounded-md border border-line bg-white px-4 py-2 text-sm font-medium text-ink transition hover:border-signal/50 disabled:opacity-50"
        >
          {saving ? "保存中..." : "保存する"}
        </button>
      </div>
    </div>
  );
}
