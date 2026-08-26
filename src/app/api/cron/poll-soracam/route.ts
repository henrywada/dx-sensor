import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { resolveSecret } from "@/lib/supabase/secrets";
import { getCameraDriver, isCloudReachable } from "@/lib/sensors/factory";
import { frameDiffScore } from "@/lib/change-detection/frameDiff";
import { recognizePlate } from "@/lib/image-analysis/plate-recognizer/plateRecognizer";

/**
 * Vercel Cron target for cloud-reachable cameras (currently: soracam only).
 * Tapo/Reolink cameras are NOT polled here — they're LAN-only and are
 * instead pushed to /api/ingest/vehicle-event by a local Raspberry Pi
 * agent. See agent/ and docs/agent-provisioning-checklist.md.
 *
 * Schedule this in vercel.json, e.g. every 1–5 minutes. Quota math
 * (see project notes on the SoraCam evaluation): even at 1-minute
 * intervals this uses under 20% of the 72-hour/month export quota per
 * camera, so interval choice here is a business decision (how fresh
 * does occupancy data need to be), not a quota constraint.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();

  const { data: cameras, error } = await supabase
    .from("cameras")
    .select(
      "id, tenant_id, vendor, soracam_device_id, soracam_auth_key_id, soracam_secret_ref, last_frame_path"
    )
    .eq("vendor", "soracam"); // only cloud-reachable vendors go through this route

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const camera of cameras ?? []) {
    try {
      if (!isCloudReachable(camera.vendor as any)) continue; // defensive; query already filters

      const driver = getCameraDriver(camera.vendor as any);

      const authKeySecret = await resolveSecret(camera.soracam_secret_ref);

      const frame = await driver.getSnapshot({
        id: camera.id,
        tenantId: camera.tenant_id,
        vendor: "soracam",
        soracamDeviceId: camera.soracam_device_id,
        soracamAuthKeyId: camera.soracam_auth_key_id,
        soracamAuthKeySecret: authKeySecret,
      });

      // Diff against the last-seen frame (stored at a fixed "latest" path,
      // overwritten every poll — separate from the permanent vehicle-events
      // archive, which only gets a new file when a significant change fires).
      const latestPath = `soracam-latest/${camera.id}.jpg`;
      let diffScore = 1; // no previous frame => treat as a change (first run)

      if (camera.last_frame_path) {
        const { data: prevFile } = await supabase.storage.from("observations").download(camera.last_frame_path);
        if (prevFile) {
          const prevBuffer = Buffer.from(await prevFile.arrayBuffer());
          diffScore = await frameDiffScore(prevBuffer, frame.buffer);
        }
      }

      // Always refresh the "latest" scratch copy for next tick's diff, regardless of outcome.
      await supabase.storage.from("observations").upload(latestPath, frame.buffer, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (camera.last_frame_path !== latestPath) {
        await supabase.from("cameras").update({ last_frame_path: latestPath }).eq("id", camera.id);
      }

      const DIFF_THRESHOLD = 0.03;
      if (diffScore < DIFF_THRESHOLD) {
        results.push({ camera: camera.id, ok: true, skipped: true, diffScore });
        continue;
      }

      // Significant change: archive permanently + run ANPR + record the event.
      const archivePath = `vehicle-events/${camera.tenant_id}/${camera.id}/${Date.now()}.jpg`;
      await supabase.storage.from("observations").upload(archivePath, frame.buffer, { contentType: "image/jpeg" });

      const anpr = await recognizePlate(frame.buffer).catch(() => null);

      const { error: insertError } = await supabase.from("vehicle_events").insert({
        tenant_id: camera.tenant_id,
        camera_id: camera.id,
        captured_at: frame.capturedAt.toISOString(),
        image_path: archivePath,
        occupied: Boolean(anpr?.plateNumber),
        plate_number: anpr?.plateNumber ?? null,
        plate_confidence: anpr?.confidence ?? null,
        vehicle_color: anpr?.vehicleColor ?? null,
        vehicle_make_model: anpr?.vehicleMakeModel ?? null,
        raw_anpr_response: anpr?.raw ?? { diffScore },
      });

      results.push({ camera: camera.id, ok: !insertError, diffScore, error: insertError?.message });
    } catch (err: any) {
      results.push({ camera: camera.id, ok: false, error: err.message });
    }
  }

  return NextResponse.json({ results });
}
