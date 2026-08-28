import { describe, expect, it } from "vitest";
import {
  BUCKET,
  finalObjectPath,
  isTmpPath,
  tmpObjectPath,
} from "./storagePaths";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const documentId = "44444444-4444-4444-8444-444444444444";

describe("storagePaths", () => {
  it("exports the captured-documents bucket name", () => {
    expect(BUCKET).toBe("captured-documents");
  });

  it("builds a tmp object path", () => {
    expect(tmpObjectPath(tenantId, userId, fileId)).toBe(
      `${tenantId}/tmp/${userId}/${fileId}.jpg`
    );
  });

  it("builds a final object path", () => {
    expect(
      finalObjectPath(
        tenantId,
        "business_card",
        "2026-08-28",
        documentId,
        fileId
      )
    ).toBe(
      `${tenantId}/business_card/2026-08-28/${documentId}/${fileId}.jpg`
    );
  });

  describe("isTmpPath", () => {
    it("returns true for a matching tmp path", () => {
      const path = tmpObjectPath(tenantId, userId, fileId);
      expect(isTmpPath(path, tenantId, userId)).toBe(true);
    });

    it("returns false when tenantId does not match", () => {
      const path = tmpObjectPath(tenantId, userId, fileId);
      expect(
        isTmpPath(path, "99999999-9999-4999-8999-999999999999", userId)
      ).toBe(false);
    });

    it("returns false when userId does not match", () => {
      const path = tmpObjectPath(tenantId, userId, fileId);
      expect(
        isTmpPath(path, tenantId, "99999999-9999-4999-8999-999999999999")
      ).toBe(false);
    });

    it("returns false for a final path", () => {
      const path = finalObjectPath(
        tenantId,
        "business_card",
        "2026-08-28",
        documentId,
        fileId
      );
      expect(isTmpPath(path, tenantId, userId)).toBe(false);
    });
  });
});
