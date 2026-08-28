import { describe, expect, it } from "vitest";
import { parseAnalyzeBody, parseCommitBody } from "./parseBody";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const frontTmpPath = `${tenantId}/tmp/${userId}/33333333-3333-4333-8333-333333333333.jpg`;
const backTmpPath = `${tenantId}/tmp/${userId}/44444444-4444-4444-8444-444444444444.jpg`;

describe("parseAnalyzeBody", () => {
  it("accepts registered document types with a front tmp image", () => {
    expect(
      parseAnalyzeBody(
        {
          documentType: "business_card",
          images: [{ role: "front", path: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toEqual({
      documentType: "business_card",
      plugin: expect.objectContaining({ id: "business_card" }),
      images: [{ role: "front", path: frontTmpPath }],
    });
  });

  it("rejects an unknown document type", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "invoice",
          images: [{ role: "front", path: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects payloads without a front image", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "business_card",
          images: [{ role: "back", path: backTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects tmp paths outside the active tenant and user", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "business_card",
          images: [
            {
              role: "front",
              path: `${tenantId}/tmp/99999999-9999-4999-8999-999999999999/file.jpg`,
            },
          ],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });
});

describe("parseCommitBody", () => {
  it("accepts a valid commit body and normalizes user fields", () => {
    expect(
      parseCommitBody(
        {
          documentType: "business_card",
          companyVisible: true,
          notes: "  met at expo  ",
          tags: [" lead ", "", "lead", 123],
          contextDate: "2026-08-28",
          extracted: { full_name: "山田太郎", email: "taro@example.com" },
          rawOcr: "山田太郎\ntaro@example.com",
          analysisRunId: "55555555-5555-4555-8555-555555555555",
          images: [{ role: "front", tmpPath: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toEqual({
      documentType: "business_card",
      plugin: expect.objectContaining({ id: "business_card" }),
      existingId: null,
      companyVisible: true,
      companyVisibleProvided: true,
      notes: "met at expo",
      notesProvided: true,
      tags: ["lead"],
      tagsProvided: true,
      contextDate: "2026-08-28",
      contextDateProvided: true,
      extracted: { full_name: "山田太郎", email: "taro@example.com" },
      rawOcr: "山田太郎\ntaro@example.com",
      rawOcrProvided: true,
      analysisRunId: "55555555-5555-4555-8555-555555555555",
      images: [{ role: "front", tmpPath: frontTmpPath }],
    });
  });

  it("rejects page images for business cards", () => {
    expect(() =>
      parseCommitBody(
        {
          documentType: "business_card",
          companyVisible: false,
          images: [{ role: "page", tmpPath: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });
});
