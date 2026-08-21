import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { getCameraDriver } from "@/lib/cameras/factory";
import { recognizePlate } from "@/lib/anpr/plateRecognizer";

/**
 * Vercel Cron target: schedule in vercel.json, e.g. every 5 minutes.
 * Pull-based ingestion path (use this if cameras are NOT configured for
 * native FTP push — see /docs/camera-ftp-setup.md for the push alternative).
 *
 * Flow per camera:
 *   1. getSnapshot() via the vendor-specific ONVIF driver
 *   2. upload the JPEG to Supabase Storage
 *   3. run ANPR only if the spot is judged occupied (cheap check first
 *      to avoid burning ANPR lookups on empty spots)
 *   4. write a vehicle_events row via the service-role client
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();

  const { data: cameras, error } = await supabase
    .from("cameras")
    .select("id, tenant_id, vendor, host, port, username, secret_ref, onvif_profile_token");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = [];

  for (const camera of cameras ?? []) {
    try {
      const driver = getCameraDriver(camera.vendor as any);

      // TODO: resolve camera.secret_ref -> actual password via your secret store
      // (Supabase Vault, Vercel env, etc.) instead of storing plaintext.
      const password = await resolveSecret(camera.secret_ref);

      const snapshot = await driver.getSnapshot({
        id: camera.id,
        tenantId: camera.tenant_id,
        vendor: camera.vendor as any,
        host: camera.host,
        port: camera.port,
        username: camera.username,
        password,
        onvifProfileToken: camera.onvif_profile_token ?? undefined,
      });

      // NOTE: occupancy classification and ANPR go here.
      // This scaffold stores the raw image and leaves the AI call as a TODO
      // so you can plug in the specific vision model / prompt per spot.
      const anpr = await recognizePlate(snapshot.buffer).catch(() => null);

      const { error: insertError } = await supabase.from("vehicle_events").insert({
        tenant_id: camera.tenant_id,
        camera_id: camera.id,
        // parking_spot_id: TODO — map camera frame region -> parking_spots.id
        parking_spot_id: null,
        occupied: Boolean(anpr?.plateNumber),
        plate_number: anpr?.plateNumber ?? null,
        plate_confidence: anpr?.confidence ?? null,
        vehicle_color: anpr?.vehicleColor ?? null,
        vehicle_make_model: anpr?.vehicleMakeModel ?? null,
        raw_anpr_response: anpr?.raw ?? null,
      });

      results.push({ camera: camera.id, ok: !insertError, error: insertError?.message });
    } catch (err: any) {
      results.push({ camera: camera.id, ok: false, error: err.message });
    }
  }

  return NextResponse.json({ results });
}

async function resolveSecret(secretRef: string): Promise<string> {
  // Placeholder — wire up to your actual secret storage.
  throw new Error(`resolveSecret() not implemented for ref: ${secretRef}`);
}
