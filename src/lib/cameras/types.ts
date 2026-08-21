/**
 * Vendor-agnostic camera abstraction.
 *
 * IMPORTANT: implementations must only rely on standard ONVIF calls
 * (GetSnapshotUri, GetProfiles, GetDeviceInformation, ONVIF Events)
 * plus vendor-specific FTP settings. Never depend on a vendor's
 * proprietary mobile-app-only API here — that breaks the
 * "develop on Tapo, run production on Reolink" strategy.
 */

export type CameraVendor = "tapo" | "reolink" | "other";

export interface CameraConfig {
  id: string;
  tenantId: string;
  vendor: CameraVendor;
  host: string;
  port: number;
  username: string;
  /** Resolved secret (password), fetched separately from `secret_ref` — never stored in DB directly. */
  password: string;
  onvifProfileToken?: string;
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
