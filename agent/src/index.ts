import { Cam } from "onvif";
import sharp from "sharp";

/**
 * dx-sensor local agent (runs on Raspberry Pi via balenaCloud).
 *
 * Responsibilities (and nothing else — keep this thin):
 *  1. Pull a snapshot from the local camera via ONVIF (same standard calls
 *     used by TapoDriver/ReolinkDriver in the main app — see
 *     src/lib/cameras/ for the canonical version; keep this in sync).
 *  2. Compare it to the previous frame (method 2: app-side diff, not
 *     reliant on the camera's own motion detection).
 *  3. On significant change, POST the frame to the cloud ingestion API
 *     using the agent's scoped API key. Never talk to Supabase directly.
 *
 * All config comes from environment variables, set per-device in the
 * balenaCloud dashboard before shipping the unit to a tenant site.
 */

const CAMERA_HOST = requireEnv("CAMERA_HOST");
const CAMERA_PORT = Number(process.env.CAMERA_PORT ?? "2020");
const CAMERA_USER = requireEnv("CAMERA_USER");
const CAMERA_PASS = requireEnv("CAMERA_PASS");
const INGEST_URL = requireEnv("INGEST_URL"); // e.g. https://dx-sensor.example.com/api/ingest/vehicle-event
const AGENT_API_KEY = requireEnv("AGENT_API_KEY"); // dxs_agent_...
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "60000"); // default: 1 min
const DIFF_THRESHOLD = Number(process.env.DIFF_THRESHOLD ?? "0.03"); // 3% of pixels changed

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function connectCam(): Promise<Cam> {
  return new Promise((resolve, reject) => {
    const cam = new Cam(
      { hostname: CAMERA_HOST, port: CAMERA_PORT, username: CAMERA_USER, password: CAMERA_PASS, timeout: 8000 },
      (err: Error | null) => (err ? reject(err) : resolve(cam))
    );
  });
}

async function getSnapshot(): Promise<Buffer> {
  const cam = await connectCam();
  const profileToken: string = await new Promise((resolve, reject) => {
    cam.getProfiles((err: Error | null, profiles: any[]) => {
      if (err) return reject(err);
      resolve(profiles[0].$.token ?? profiles[0].token);
    });
  });
  const uri: string = await new Promise((resolve, reject) => {
    cam.getSnapshotUri({ profileToken }, (err: Error | null, result: any) => (err ? reject(err) : resolve(result.uri)));
  });
  const res = await fetch(uri, {
    headers: { Authorization: "Basic " + Buffer.from(`${CAMERA_USER}:${CAMERA_PASS}`).toString("base64") },
  });
  if (!res.ok) throw new Error(`snapshot fetch failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Simple perceptual diff: downscale both frames to a small grayscale
 * image and compare mean pixel difference. Cheap enough to run every
 * poll cycle on a Pi 4, and vendor-agnostic (works identically on
 * Tapo or Reolink footage).
 */
async function frameDiffScore(prev: Buffer, curr: Buffer): Promise<number> {
  const size = 64;
  const [a, b] = await Promise.all([
    sharp(prev).resize(size, size).grayscale().raw().toBuffer(),
    sharp(curr).resize(size, size).grayscale().raw().toBuffer(),
  ]);
  let diffPixels = 0;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > 25) diffPixels++;
  }
  return diffPixels / a.length;
}

async function pushToIngestApi(imageBuffer: Buffer, diffScore: number) {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${AGENT_API_KEY}` },
    body: JSON.stringify({
      imageBase64: imageBuffer.toString("base64"),
      capturedAt: new Date().toISOString(),
      diffScore,
    }),
  });
  if (!res.ok) {
    console.error(`ingest failed: ${res.status} ${await res.text()}`);
  } else {
    console.log(`pushed frame (diff=${diffScore.toFixed(3)})`);
  }
}

let previousFrame: Buffer | null = null;

async function tick() {
  try {
    const frame = await getSnapshot();

    if (previousFrame) {
      const diff = await frameDiffScore(previousFrame, frame);
      if (diff >= DIFF_THRESHOLD) {
        await pushToIngestApi(frame, diff);
      } else {
        console.log(`no significant change (diff=${diff.toFixed(3)}), skipping`);
      }
    } else {
      // first run: always push a baseline frame
      await pushToIngestApi(frame, 1);
    }

    previousFrame = frame;
  } catch (err) {
    console.error("tick failed:", err);
    // do not crash the agent on a transient camera/network error — retry next tick
  }
}

console.log(`dx-sensor agent starting. Polling every ${POLL_INTERVAL_MS}ms, camera at ${CAMERA_HOST}:${CAMERA_PORT}`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
