import { describe, expect, it } from "vitest";
import {
  bucketYenByJstDate,
  buildJstDateKeys,
} from "./getDashboardStats";

describe("bucketYenByJstDate", () => {
  it("sums estimated_cost_yen by JST calendar day", () => {
    // 2026-08-24 23:30 JST = 2026-08-24 14:30 UTC
    // 2026-08-25 00:30 JST = 2026-08-24 15:30 UTC
    const dateKeys = ["2026-08-24", "2026-08-25", "2026-08-26"];
    const series = bucketYenByJstDate(
      [
        {
          created_at: "2026-08-24T14:30:00.000Z",
          estimated_cost_yen: 0.05,
        },
        {
          created_at: "2026-08-24T14:45:00.000Z",
          estimated_cost_yen: 0.07,
        },
        {
          created_at: "2026-08-24T15:30:00.000Z",
          estimated_cost_yen: 0.1,
        },
        {
          created_at: "2026-08-25T01:00:00.000Z",
          estimated_cost_yen: null,
        },
      ],
      dateKeys
    );

    expect(series).toEqual([
      { date: "2026-08-24", yen: 0.12 },
      { date: "2026-08-25", yen: 0.1 },
      { date: "2026-08-26", yen: 0 },
    ]);
  });

  it("returns zeros for empty rows over buildJstDateKeys range", () => {
    const keys = buildJstDateKeys(3, new Date("2026-08-26T12:00:00+09:00"));
    const series = bucketYenByJstDate([], keys);
    expect(series).toHaveLength(3);
    expect(series.every((p) => p.yen === 0)).toBe(true);
  });
});
