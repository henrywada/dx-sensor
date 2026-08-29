import { describe, expect, it } from "vitest";
import {
  parseAnalyzeBody,
  parseCommitBody,
  parseLineItemsBody,
} from "./parseBody";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const frontTmpPath = `${tenantId}/tmp/${userId}/33333333-3333-4333-8333-333333333333.jpg`;
const backTmpPath = `${tenantId}/tmp/${userId}/44444444-4444-4444-8444-444444444444.jpg`;
const pageTmpPath = `${tenantId}/tmp/${userId}/a.jpg`;

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
      documentMode: null,
      plugin: expect.objectContaining({ id: "business_card" }),
      images: [{ role: "front", path: frontTmpPath }],
    });
  });

  it("accepts page-only images for invoice", () => {
    const body = parseAnalyzeBody(
      {
        documentType: "invoice",
        images: [{ role: "page", path: pageTmpPath }],
      },
      { tenantId, userId }
    );
    expect(body.images[0].role).toBe("page");
  });

  it("rejects an unknown document type", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "unknown_type",
          images: [{ role: "front", path: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("accepts receipt with a valid documentMode and returns the resolved mode", () => {
    const body = parseAnalyzeBody(
      {
        documentType: "receipt",
        documentMode: "expense",
        images: [{ role: "page", path: pageTmpPath }],
      },
      { tenantId, userId }
    );
    expect(body.documentMode).toBe("expense");
    expect(body.plugin.id).toBe("receipt");
  });

  it("rejects receipt without a documentMode", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "receipt",
          images: [{ role: "page", path: pageTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects receipt with an invalid documentMode", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "receipt",
          documentMode: "bogus",
          images: [{ role: "page", path: pageTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects front-role images for receipt", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "receipt",
          documentMode: "expense",
          images: [{ role: "front", path: frontTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects more than one page image for receipt", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "receipt",
          documentMode: "expense",
          images: [
            { role: "page", path: pageTmpPath },
            { role: "page", path: pageTmpPath },
          ],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });

  it("rejects page images for business cards", () => {
    expect(() =>
      parseAnalyzeBody(
        {
          documentType: "business_card",
          images: [{ role: "page", path: pageTmpPath }],
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
      documentMode: null,
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
      lineItems: [],
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

  it("requires lineItems for invoice commits", () => {
    expect(() =>
      parseCommitBody(
        {
          documentType: "invoice",
          companyVisible: false,
          images: [{ role: "page", tmpPath: pageTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow("lineItems is required");
  });

  it("accepts empty lineItems for invoice commits", () => {
    expect(
      parseCommitBody(
        {
          documentType: "invoice",
          companyVisible: false,
          images: [{ role: "page", tmpPath: pageTmpPath }],
          lineItems: [],
        },
        { tenantId, userId }
      )
    ).toMatchObject({
      documentType: "invoice",
      images: [{ role: "page", tmpPath: pageTmpPath }],
      lineItems: [],
    });
  });

  it("parses invoice lineItems from the commit body", () => {
    expect(
      parseCommitBody(
        {
          documentType: "invoice",
          companyVisible: false,
          images: [{ role: "page", tmpPath: pageTmpPath }],
          lineItems: [
            {
              line_no: 1,
              transaction_date: "2026-08-28",
              description: "サンプルA",
              quantity: "1",
              unit: "式",
              unit_price: "10000",
              amount: "10000",
              tax_rate: "10",
            },
          ],
        },
        { tenantId, userId }
      ).lineItems
    ).toEqual([
      {
        line_no: 1,
        transaction_date: "2026-08-28",
        description: "サンプルA",
        quantity: "1",
        unit: "式",
        unit_price: "10000",
        amount: "10000",
        tax_rate: "10",
      },
    ]);
  });

  it("round-trips documentMode for a receipt commit without requiring lineItems", () => {
    const result = parseCommitBody(
      {
        documentType: "receipt",
        documentMode: "qualified_invoice",
        companyVisible: false,
        images: [{ role: "page", tmpPath: pageTmpPath }],
      },
      { tenantId, userId }
    );
    expect(result.documentMode).toBe("qualified_invoice");
    expect(result.lineItems).toEqual([]);
  });

  it("rejects a receipt commit with an invalid documentMode", () => {
    expect(() =>
      parseCommitBody(
        {
          documentType: "receipt",
          documentMode: "bogus",
          companyVisible: false,
          images: [{ role: "page", tmpPath: pageTmpPath }],
        },
        { tenantId, userId }
      )
    ).toThrow();
  });
});

describe("parseLineItemsBody", () => {
  it("returns an empty array for document types without line items", () => {
    expect(
      parseLineItemsBody(
        { documentType: "business_card" },
        { id: "business_card" } as never
      )
    ).toEqual([]);
  });
});
