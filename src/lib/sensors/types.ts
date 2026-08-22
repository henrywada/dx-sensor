/**
 * Vendor-agnostic camera abstraction.
 *
 * IMPORTANT: implementations must only rely on standard ONVIF calls
 * (GetSnapshotUri, GetProfiles, GetDeviceInformation, ONVIF Events)
 * plus vendor-specific FTP settings. Never depend on a vendor's
 * proprietary mobile-app-only API here — that breaks the
 * "develop on Tapo, run production on Reolink" strategy.
 */

export type CameraVendor = "tapo" | "reolink" | "soracam" | "other";

/**
 * Two very different connection shapes are needed depending on vendor:
 *  - ONVIF vendors (tapo/reolink): host/port/username/password on the LAN.
 *    These are only reachable from a local agent (see agent/), never from
 *    the cloud directly.
 *  - soracam: no LAN address at all. Auth is via SORACOM API credentials
 *    (Auth Key ID/Secret) plus the SoraCam device ID. Reachable directly
 *    from the cloud (Vercel Cron etc.) since SORACOM's API is public.
 * Both shapes are folded into one CameraConfig so CameraDriver stays a
 * single interface; each driver only reads the fields it needs.
 */
export interface CameraConfig {
  id: string;
  tenantId: string;
  vendor: CameraVendor;

  // --- ONVIF vendors (tapo/reolink) ---
  host?: string;
  port?: number;
  username?: string;
  /** Resolved secret (password), fetched separately from `secret_ref` — never stored in DB directly. */
  password?: string;
  onvifProfileToken?: string;

  // --- soracam ---
  soracamDeviceId?: string;
  soracamAuthKeyId?: string;
  /** Resolved secret, same non-persistence rule as `password` above. */
  soracamAuthKeySecret?: string;
}

export interface SnapshotResult {
  buffer: Buffer;
  contentType: string;
  capturedAt: Date;
}

export interface CameraDriver {
  readonly vendor: CameraVendor;

  /** Fetch a single still image via ONVIF GetSnapshotUri (or vendor HTTP CGI fallback). */
  getSnapshot(config: CameraConfig): Promise<SnapshotResult>;

  /** Resolve the ONVIF media profile token if not already known. */
  resolveProfileToken(config: CameraConfig): Promise<string>;

  /** Optional: subscribe to ONVIF motion events. Not all vendors implement this reliably. */
  onMotionEvent?(
    config: CameraConfig,
    callback: (eventAt: Date) => void
  ): Promise<() => void /* unsubscribe */>;
}
