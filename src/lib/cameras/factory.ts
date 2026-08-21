import type { CameraDriver, CameraVendor } from "./types";
import { TapoDriver } from "./drivers/tapoDriver";
import { ReolinkDriver } from "./drivers/reolinkDriver";

const drivers: Record<CameraVendor, CameraDriver> = {
  tapo: new TapoDriver(),
  reolink: new ReolinkDriver(),
  other: new ReolinkDriver(), // fallback: assume standard ONVIF behavior
};

/**
 * Returns the driver for a given camera's vendor.
 * `cameras.vendor` in the DB is the single source of truth —
 * switching a tenant from dev (tapo) to prod (reolink) is a one-column update.
 */
export function getCameraDriver(vendor: CameraVendor): CameraDriver {
  const driver = drivers[vendor];
  if (!driver) {
    throw new Error(`No camera driver registered for vendor "${vendor}"`);
  }
  return driver;
}
