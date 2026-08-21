import { Cam } from "onvif";
import type { CameraConfig, CameraDriver, SnapshotResult } from "../types";

/**
 * TP-Link Tapo (C110/C210 etc.) driver.
 * Used for local development — cheap and easy to acquire.
 * Only standard ONVIF Profile S calls are used, so this driver's
 * behavior should generalize to ReolinkDriver in production.
 *
 * Known quirks to watch for during dev:
 *  - Firmware updates occasionally change ONVIF event support.
 *  - Some Tapo models require ONVIF to be explicitly enabled in the Tapo app
 *    (Settings > Advanced > Camera Account) before this will work at all.
 */
export class TapoDriver implements CameraDriver {
  readonly vendor = "tapo" as const;

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
      throw new Error(`Tapo snapshot fetch failed: ${res.status} ${res.statusText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      capturedAt: new Date(),
    };
  }
}
