import type { CameraDriver, CameraVendor } from "./types";
// soracam系列: SORACOMクラウドAPI経由で直接アクセスする方式（ローカルエージェント不要）
import { SoraCamDriver } from "./soracam/soraCamDriver";

/**
 * IMPORTANT: this factory only registers cloud-reachable drivers (soracam).
 *
 * tapo/reolink (ONVIF, LAN-only) drivers are NOT imported here on purpose —
 * this file is bundled into the Next.js app, which runs in the cloud and
 * can never reach a camera on a tenant's private LAN (see the local-agent
 * architecture discussion in docs/agent-provisioning-checklist.md). Their
 * canonical implementation lives only in agent/src/ (a separate npm
 * package that runs on the Raspberry Pi, on the same LAN as the camera).
 * Importing the ONVIF drivers here would pull the `onvif` package into
 * the cloud app's build for code that can structurally never execute —
 * this previously caused real build failures, which is why the rule
 * is enforced this way rather than just documented.
 */
const drivers: Partial<Record<CameraVendor, CameraDriver>> = {
  soracam: new SoraCamDriver(),
};

/**
 * Whether this vendor is reachable directly from the cloud (no local
 * agent required). Used by the ingestion layer to decide whether a
 * camera is polled by a Vercel Cron job (soracam) or must wait for a
 * local agent to push data (tapo/reolink, LAN-only).
 */
export function isCloudReachable(vendor: CameraVendor): boolean {
  return vendor === "soracam";
}

/**
 * Returns the driver for a given camera's vendor.
 * `cameras.vendor` in the DB is the single source of truth.
 *
 * Only cloud-reachable vendors (soracam) resolve here. For tapo/reolink,
 * this throws — those vendors are never driven from the cloud app; the
 * local agent (agent/src/) has its own equivalent driver instantiation
 * and never calls this factory. If this throws unexpectedly, it usually
 * means a cloud-side code path (e.g. a Cron route) queried cameras
 * without filtering `vendor='soracam'` — check `isCloudReachable()` first.
 */
export function getCameraDriver(vendor: CameraVendor): CameraDriver {
  const driver = drivers[vendor];
  if (!driver) {
    throw new Error(
      `No cloud-side driver registered for vendor "${vendor}". ` +
        `If this is tapo/reolink, that's expected — those are LAN-only and ` +
        `must be driven by the local agent, not the cloud app.`
    );
  }
  return driver;
}
