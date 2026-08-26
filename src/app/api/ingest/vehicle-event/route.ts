import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/server";
import { hashAgentKey } from "@/lib/agent-keys/key";
import { recognizePlate } from "@/lib/image-analysis/plate-recognizer/plateRecognizer";

/**
 * Local-agent ingestion endpoint.
 *
 * Auth: `Authorization: Bearer dxs_agent_...` — NOT a Supabase session,
 * NOT the service_role key. The agent only ever holds this one opaque token.
 *
 * The tenant_id and camera_id are resolved server-side from the key —
 * they are NEVER trusted from the request body. This is the critical
 * boundary that keeps one compromised agent from writing another
 * tenant's data.
 *
 * Expected JSON body:
 * {
 *   "imageBase64": "...",          // JPEG, base64-encoded
 *   "capturedAt": "2026-08-22T10:00:00Z",
 *   "diffScore": 0.42              // the agent's own frame-diff score (method 2), for logging
 * }
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const rawKey = authHeader?.replace(/^Bearer\s+/i, "");

  if (!rawKey || !rawKey.startsWith("dxs_agent_")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();
  const keyHash = hashAgentKey(rawKey);

  const { data: agentKey, error: keyError } = await supabase
    .from("agent_api_keys")
    .select("id, tenant_id, camera_id, revoked_at")
    .eq("key_hash", keyHash)
    .single();

  if (keyError || !agentKey || agentKey.revoked_at) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { imageBase64, capturedAt, diffScore } = body;

  if (!imageBase64) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const imageBuffer = Buffer.from(imageBase64, "base64");
  const cameraSegment = agentKey.camera_id ?? "nocamera";

  // Store the raw image
  const storagePath = `vehicle-events/${agentKey.tenant_id}/${cameraSegment}/${Date.now()}.jpg`;
  const { error: uploadError } = await supabase.storage
    .from("observations") // create this bucket in Supabase Storage beforehand
    .upload(storagePath, imageBuffer, { contentType: "image/jpeg" });

  if (uploadError) {
    return NextResponse.json({ error: `storage upload failed: ${uploadError.message}` }, { status: 500 });
  }

  // ANPR (only run when the agent's own diff detection flagged a likely change —
  // the agent should already have filtered near-identical frames before calling this endpoint)
  const anpr = await recognizePlate(imageBuffer).catch(() => null);

  const { error: insertError } = await supabase.from("vehicle_events").insert({
    tenant_id: agentKey.tenant_id,
    camera_id: agentKey.camera_id,
    captured_at: capturedAt ?? new Date().toISOString(),
    image_path: storagePath,
    occupied: Boolean(anpr?.plateNumber),
    plate_number: anpr?.plateNumber ?? null,
    plate_confidence: anpr?.confidence ?? null,
    vehicle_color: anpr?.vehicleColor ?? null,
    vehicle_make_model: anpr?.vehicleMakeModel ?? null,
    raw_anpr_response: anpr?.raw ?? { agentDiffScore: diffScore },
  });

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await supabase
    .from("agent_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", agentKey.id);

  return NextResponse.json({ ok: true });
}
