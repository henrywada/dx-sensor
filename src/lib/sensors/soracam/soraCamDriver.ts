import type { CameraConfig, CameraDriver, SnapshotResult } from "../types";

/**
 * ATOM Cam 2 / ATOM Cam Swing via SORACOM's SoraCam API.
 *
 * UNLIKE TapoDriver/ReolinkDriver, this driver talks to a public cloud API
 * (api.soracom.io), not a LAN-local ONVIF endpoint. That means:
 *   - It can run directly in a Vercel/Cloudflare Cron job — no local
 *     Raspberry Pi agent is needed for this vendor.
 *   - `CameraConfig.host/port/username/password` are unused for this
 *     driver; instead it uses `soracamDeviceId` + `soracamAuthKeyId` +
 *     `soracamAuthKeySecret`.
 *
 * ⚠️ IMPLEMENTATION STATUS: the auth flow below (POST /v1/auth) is the
 * standard, stable SORACOM platform auth mechanism and can be trusted.
 * The still-image export endpoint path/shape (`exportImage` /
 * `getImageExportStatus` below) could NOT be confirmed against the
 * interactive API reference during design (it's a JS-rendered Swagger UI
 * that isn't scrapable). CONFIRM THE EXACT PATHS at
 * https://users.soracom.io/ja-jp/tools/api/reference/#/SoraCam
 * (or via `soracom sora-cam devices events list` / equivalent CLI
 * commands, which are known-working per SORACOM's own blog posts) before
 * running this against a real device. Treat the method bodies below as a
 * structurally-correct skeleton, not verified-working code.
 */
export class SoraCamDriver implements CameraDriver {
  readonly vendor = "soracam" as const;

  private apiBase = process.env.SORACOM_API_ENDPOINT ?? "https://api.soracom.io/v1";
  private tokenCache: { apiKey: string; token: string; expiresAt: number } | null = null;

  private async authenticate(config: CameraConfig): Promise<{ apiKey: string; token: string }> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache;
    }
    const res = await fetch(`${this.apiBase}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        authKeyId: config.soracamAuthKeyId,
        authKeySecret: config.soracamAuthKeySecret,
      }),
    });
    if (!res.ok) throw new Error(`SORACOM auth failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    // Tokens are short-lived; cache with a safety margin (actual TTL: confirm in docs).
    this.tokenCache = { apiKey: data.apiKey, token: data.token, expiresAt: Date.now() + 20 * 60 * 1000 };
    return this.tokenCache;
  }

  private async authedFetch(config: CameraConfig, path: string, init?: RequestInit) {
    const { apiKey, token } = await this.authenticate(config);
    return fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        "X-Soracom-API-Key": apiKey,
        "X-Soracom-Token": token,
        "Content-Type": "application/json",
      },
    });
  }

  /**
   * SoraCam doesn't have an ONVIF profile concept — this is a no-op that
   * exists only to satisfy the CameraDriver interface.
   */
  async resolveProfileToken(_config: CameraConfig): Promise<string> {
    return "";
  }

  /**
   * Method-2 compliant: exports a still image for "right now" from the
   * device's cloud recording, polls until ready, downloads it.
   *
   * Quota note: each call consumes 1 second of the camera's 72-hour/month
   * export quota (see docs/soracam-evaluation notes) — at any polling
   * interval ≥ 10s this is effectively unlimited for dx-sensor's use case.
   */
  async getSnapshot(config: CameraConfig): Promise<SnapshotResult> {
    if (!config.soracamDeviceId) {
      throw new Error("soracamDeviceId is required for SoraCamDriver");
    }

    const now = Date.now();

    // TODO(verify): confirm exact path/body against the SoraCam API reference.
    // Expected shape: request an image export at `time`, get back a job id.
    const exportRes = await this.authedFetch(
      config,
      `/sora_cam/devices/${config.soracamDeviceId}/images/exports`,
      { method: "POST", body: JSON.stringify({ time: now }) }
    );
    if (!exportRes.ok) {
      throw new Error(`SoraCam image export request failed: ${exportRes.status} ${await exportRes.text()}`);
    }
    const exportJob = await exportRes.json();
    const exportId: string = exportJob.exportId ?? exportJob.id;

    // Poll for completion. TODO(verify): confirm status field name/values and endpoint path.
    let downloadUrl: string | null = null;
    for (let attempt = 0; attempt < 10 && !downloadUrl; attempt++) {
      await new Promise((r) => setTimeout(r, 1000));
      const statusRes = await this.authedFetch(
        config,
        `/sora_cam/devices/${config.soracamDeviceId}/images/exports/${exportId}`
      );
      if (!statusRes.ok) continue;
      const status = await statusRes.json();
      if (status.status === "completed" || status.state === "exported") {
        downloadUrl = status.url ?? status.downloadUrl;
      }
    }

    if (!downloadUrl) {
      throw new Error("SoraCam image export timed out waiting for a download URL");
    }

    const imageRes = await fetch(downloadUrl);
    if (!imageRes.ok) throw new Error(`SoraCam image download failed: ${imageRes.status}`);

    return {
      buffer: Buffer.from(await imageRes.arrayBuffer()),
      contentType: imageRes.headers.get("content-type") ?? "image/jpeg",
      capturedAt: new Date(now),
    };
  }
}
