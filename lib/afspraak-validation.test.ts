import { describe, expect, it } from "vitest";
import {
  type AfspraakInput,
  DEFAULT_DURATION_MINUTES,
  type ExistingAfspraak,
  findConflicts,
  slotsOverlap,
  validateAfspraakInput,
} from "./afspraak-validation";

/**
 * Unit tests for the pure afspraak validation + conflict core (Story A-1-S1).
 * No Convex runtime; synthetic ids/timestamps only — no patient data (BR-10).
 */

const NOW = new Date("2026-06-02T10:00:00.000Z");
const FUTURE = NOW.getTime() + 60 * 60_000; // +1 hour
const PAST = NOW.getTime() - 60 * 60_000; // -1 hour

function input(overrides: Partial<AfspraakInput> = {}): AfspraakInput {
  return {
    patientId: "patient_1",
    behandelaarId: "user_behandelaar_1",
    startDatetime: FUTURE,
    durationMinutes: DEFAULT_DURATION_MINUTES,
    ...overrides,
  };
}

describe("validateAfspraakInput", () => {
  it("accepts a complete, future, well-formed input", () => {
    expect(validateAfspraakInput(input(), NOW)).toEqual([]);
  });

  it("rejects a start in the past (BR-5)", () => {
    const errors = validateAfspraakInput(input({ startDatetime: PAST }), NOW);
    expect(errors.map((e) => e.code)).toContain("start_not_future");
  });

  it("rejects a start exactly equal to now (must be strictly future)", () => {
    const errors = validateAfspraakInput(input({ startDatetime: NOW.getTime() }), NOW);
    expect(errors.map((e) => e.code)).toContain("start_not_future");
  });

  it("requires a patient and a behandelaar", () => {
    const errors = validateAfspraakInput(input({ patientId: "  ", behandelaarId: "" }), NOW);
    expect(errors.map((e) => e.field).sort()).toEqual(["behandelaarId", "patientId"]);
  });

  it("rejects a non-positive or non-integer duration", () => {
    for (const durationMinutes of [0, -30, 15.5, 9999]) {
      const errors = validateAfspraakInput(input({ durationMinutes }), NOW);
      expect(
        errors.map((e) => e.code),
        `duration=${durationMinutes}`,
      ).toContain("duration_invalid");
    }
  });

  it("rejects a non-finite startDatetime as required", () => {
    const errors = validateAfspraakInput(input({ startDatetime: Number.NaN }), NOW);
    expect(errors.find((e) => e.field === "startDatetime")?.code).toBe("required");
  });

  it("never includes patient-identifying text in messages", () => {
    const errors = validateAfspraakInput(input({ startDatetime: PAST, durationMinutes: 0 }), NOW);
    for (const e of errors) {
      expect(e.message).not.toContain("patient_1");
      expect(e.message).not.toContain("user_behandelaar_1");
    }
  });
});

describe("slotsOverlap (half-open intervals)", () => {
  const t = (h: number, m = 0) => Date.UTC(2026, 5, 2, h, m);

  it("detects an overlapping slot", () => {
    // 10:00-10:30 vs 10:15-10:45 → overlap
    expect(slotsOverlap(t(10, 0), 30, t(10, 15), 30)).toBe(true);
  });

  it("treats back-to-back slots as non-overlapping", () => {
    // 10:00-10:30 vs 10:30-11:00 → touch, no overlap
    expect(slotsOverlap(t(10, 0), 30, t(10, 30), 30)).toBe(false);
  });

  it("detects full containment", () => {
    // 10:00-11:00 contains 10:15-10:30
    expect(slotsOverlap(t(10, 0), 60, t(10, 15), 15)).toBe(true);
  });

  it("returns false for clearly separate slots", () => {
    expect(slotsOverlap(t(9, 0), 30, t(11, 0), 30)).toBe(false);
  });
});

describe("findConflicts", () => {
  const t = (h: number, m = 0) => Date.UTC(2026, 5, 2, h, m);

  function existing(overrides: Partial<ExistingAfspraak> = {}): ExistingAfspraak {
    return {
      _id: "afspraak_x",
      startDatetime: t(10, 0),
      durationMinutes: 30,
      status: "gepland",
      ...overrides,
    };
  }

  it("flags an overlapping gepland afspraak (AC-8)", () => {
    const conflicts = findConflicts(t(10, 15), 30, [existing()]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.afspraakId).toBe("afspraak_x");
  });

  it("flags an overlapping bevestigd afspraak", () => {
    const conflicts = findConflicts(t(10, 15), 30, [existing({ status: "bevestigd" })]);
    expect(conflicts).toHaveLength(1);
  });

  it("ignores cancelled and completed afspraken (slot freed)", () => {
    const conflicts = findConflicts(t(10, 15), 30, [
      existing({ _id: "a1", status: "geannuleerd" }),
      existing({ _id: "a2", status: "voltooid" }),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("ignores non-overlapping afspraken", () => {
    const conflicts = findConflicts(t(13, 0), 30, [existing()]);
    expect(conflicts).toEqual([]);
  });

  it("returns only PII-free fields", () => {
    const conflicts = findConflicts(t(10, 15), 30, [existing()]);
    expect(Object.keys(conflicts[0] ?? {}).sort()).toEqual([
      "afspraakId",
      "durationMinutes",
      "startDatetime",
    ]);
  });
});
