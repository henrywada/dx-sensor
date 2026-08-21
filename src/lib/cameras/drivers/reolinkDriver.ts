import { Cam } from "onvif";
import type { CameraConfig, CameraDriver, SnapshotResult } from "../types";

/**
 * Reolink (RLC / E1 series) driver — intended for production.
 *
 * Reolink exposes both:
 *  (a) standard ONVIF GetSnapshotUri (used here, kept identical to TapoDriver
 *      so behavior verified in dev transfers to prod), and
 *  (b) native FTP upload on motion detection, configured on-device
 *      (not via this driver — see /docs/camera-ftp-setup.md).
 *
 * If a production deployment relies on FTP-pushed images instead of pull-based
 * snapshots, images arrive in Storage via a separate ingestion route
 * (see src/app/api/cron/ingest-ftp/route.ts placeholder) rather than through
 * getSnapshot(). getSnapshot() remains available for on-demand pull scenarios
 * (e.g. manual refresh from the dashboard).
 */
export class ReolinkDriver implements CameraDriver {
  readonly vendor = "reolink" as const;

  private connect(config: CameraConfig): Promise<Cam> {
    return new Promise((resolve, reject) => {
      const cam = new Cam(
        {
          hostname: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          timeout: 8000,
        },
        (err: Error | null) => {
          if (err) return reject(err);
          resolve(cam);
        }
      );
    });
  }

  async resolveProfileToken(config: CameraConfig): Promise<string> {
    const cam = await this.connect(config);
    return new Promise((resolve, reject) => {
      cam.getProfiles((err: Error | null, profiles: any[]) => {
        if (err) return reject(err);
        if (!profiles?.length) return reject(new Error("No ONVIF profiles returned"));
        resolve(profiles[0].$.token ?? profiles[0].token);
      });
    });
  }

  async getSnapshot(config: CameraConfig): Promise<SnapshotResult> {
    const cam = await this.connect(config);
    const token = config.onvifProfileToken ?? (await this.resolveProfileToken(config));

    const snapshotUri: string = await new Promise((resolve, reject) => {
      cam.getSnapshotUri({ profileToken: token }, (err: Error | null, result: any) => {
        if (err) return reject(err);
        resolve(result.uri);
      });
    });

    const res = await fetch(snapshotUri, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64"),
      },
    });

    if (!res.ok) {
      throw new Error(`Reolink snapshot fetch failed: ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      capturedAt: new Date(),
    };
  }
}
