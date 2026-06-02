import type { GenericId } from "convex/values";
import { describe, expect, it } from "vitest";
import {
  type AfspraakSummary,
  type BehandelingSummary,
  RECENT_BEHANDELINGEN_LIMIT,
  selectRecentBehandelingen,
  selectUpcomingAfspraken,
} from "./patients";

/**
 * Tests for the patient-profile VIEW selection helpers (Story P-1-S2; FR-3).
 * These exercise the pure logic the `getPatientForView` mutation wires up —
 * which afspraken count as "upcoming" and how the "last five behandelingen" are
 * chosen/sorted — without a Convex runtime (the live deploy + the audit-on-view
 * are verified manually; see the PR's manual test steps).
 *
 * All data is SYNTHETIC: no patient-identifying values appear here (AVG/GDPR,
 * BR-11). Ids are opaque synthetic strings, dates/times are arbitrary.
 */

const NOW = Date.UTC(2026, 5, 2, 12, 0, 0); // 2026-06-02T12:00:00Z

function afspraak(
  id: string,
  overrides: Partial<Omit<AfspraakSummary, "_id">> = {},
): AfspraakSummary {
  return {
    _id: id as GenericId<"afspraak">,
    startDatetime: NOW,
    durationMinutes: 30,
    status: "gepland",
    behandelaarId: "user_synthetic",
    ...overrides,
  };
}

function behandeling(
  id: string,
  treatmentDate: string,
  overrides: Partial<Omit<BehandelingSummary, "_id" | "treatmentDate">> = {},
): BehandelingSummary {
  return {
    _id: id as GenericId<"behandeling">,
    treatmentDate,
    behandelaarId: "user_synthetic",
    behandelsoortId: "soort_synthetic" as GenericId<"behandelsoort">,
    status: "definitief",
    ...overrides,
  };
}

describe("selectUpcomingAfspraken (FR-3)", () => {
  it("keeps only afspraken at/after now, soonest first", () => {
    const result = selectUpcomingAfspraken(
      [
        afspraak("a_later", { startDatetime: NOW + 2_000 }),
        afspraak("a_past", { startDatetime: NOW - 1_000 }),
        afspraak("a_soon", { startDatetime: NOW + 1_000 }),
        afspraak("a_now", { startDatetime: NOW }),
      ],
      NOW,
    );
    expect(result.map((a) => a._id)).toEqual(["a_now", "a_soon", "a_later"]);
  });

  it("excludes cancelled afspraken even when they are in the future", () => {
    const result = selectUpcomingAfspraken(
      [
        afspraak("a_cancelled", { startDatetime: NOW + 1_000, status: "geannuleerd" }),
        afspraak("a_planned", { startDatetime: NOW + 2_000, status: "gepland" }),
      ],
      NOW,
    );
    expect(result.map((a) => a._id)).toEqual(["a_planned"]);
  });

  it("returns an empty array when there are no afspraken (Sprint 1 empty state)", () => {
    expect(selectUpcomingAfspraken([], NOW)).toEqual([]);
  });
});

describe("selectRecentBehandelingen (FR-3)", () => {
  it("returns at most five, most recent treatmentDate first", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      // 2026-06-01 .. 2026-06-07
      behandeling(`b_${i}`, `2026-06-0${i + 1}`),
    );
    const result = selectRecentBehandelingen(rows);
    expect(result).toHaveLength(RECENT_BEHANDELINGEN_LIMIT);
    expect(result.map((b) => b.treatmentDate)).toEqual([
      "2026-06-07",
      "2026-06-06",
      "2026-06-05",
      "2026-06-04",
      "2026-06-03",
    ]);
  });

  it("breaks same-date ties deterministically by id (stable order)", () => {
    const result = selectRecentBehandelingen([
      behandeling("b_a", "2026-06-01"),
      behandeling("b_c", "2026-06-01"),
      behandeling("b_b", "2026-06-01"),
    ]);
    expect(result.map((b) => b._id)).toEqual(["b_c", "b_b", "b_a"]);
  });

  it("returns an empty array when there are no behandelingen (Sprint 1 empty state)", () => {
    expect(selectRecentBehandelingen([])).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const rows = [behandeling("b_1", "2026-06-01"), behandeling("b_2", "2026-06-02")];
    const snapshot = rows.map((b) => b._id);
    selectRecentBehandelingen(rows);
    expect(rows.map((b) => b._id)).toEqual(snapshot);
  });
});
