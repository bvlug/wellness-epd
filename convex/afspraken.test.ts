import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import type { AfspraakConflict, AfspraakInput } from "../lib/afspraak-validation";
import {
  AfspraakCreationError,
  type PatientStatus,
  buildAfspraakDocument,
  resolveAfspraakCreation,
} from "./afspraken";
import { InactiveBehandelsoortError } from "./behandelsoort";

/**
 * Unit tests for the pure afspraak-creation core (Story A-1-S1). They exercise
 * the validation → patient → behandelsoort → conflict pipeline through injected
 * lookups, with no Convex runtime. Synthetic ids/timestamps only (BR-10).
 */

const NOW = new Date("2026-06-02T10:00:00.000Z");
const FUTURE = NOW.getTime() + 60 * 60_000;

function input(overrides: Partial<AfspraakInput> = {}): AfspraakInput {
  return {
    patientId: "patient_1",
    behandelaarId: "user_behandelaar_1",
    startDatetime: FUTURE,
    durationMinutes: 30,
    ...overrides,
  };
}

/** Default dependency wiring: active patient, active behandelsoort, no conflicts. */
function deps(over: Partial<Parameters<typeof resolveAfspraakCreation>[0]> = {}) {
  return {
    input: input(),
    acknowledgeConflict: false,
    now: NOW,
    patientStatus: (): Promise<PatientStatus> => Promise.resolve("active"),
    ensureBehandelsoortActive: (): Promise<void> => Promise.resolve(),
    detectConflicts: (): Promise<AfspraakConflict[]> => Promise.resolve([]),
    ...over,
  };
}

describe("buildAfspraakDocument", () => {
  it("always sets status gepland (FR-6)", () => {
    expect(buildAfspraakDocument(input()).status).toBe("gepland");
  });

  it("includes a behandelsoortId only when one is supplied", () => {
    expect(buildAfspraakDocument(input()).behandelsoortId).toBeUndefined();
    const withSoort = buildAfspraakDocument(input({ behandelsoortId: "bs_1" }));
    expect(withSoort.behandelsoortId).toBe("bs_1");
  });

  it("drops empty/whitespace notities rather than storing an empty string", () => {
    expect(buildAfspraakDocument(input({ notities: "   " })).notities).toBeUndefined();
    expect(buildAfspraakDocument(input({ notities: " hint " })).notities).toBe("hint");
  });
});

describe("resolveAfspraakCreation", () => {
  it("returns the document to insert on the happy path", async () => {
    const document = await resolveAfspraakCreation(deps());
    expect(document.status).toBe("gepland");
    expect(document.behandelaarId).toBe("user_behandelaar_1");
  });

  it("throws validation_failed for a past start (BR-5)", async () => {
    const past = NOW.getTime() - 60 * 60_000;
    await expect(
      resolveAfspraakCreation(deps({ input: input({ startDatetime: past }) })),
    ).rejects.toMatchObject({ data: { code: "validation_failed" } });
  });

  it("throws patient_not_found when the patient does not exist", async () => {
    await expect(
      resolveAfspraakCreation(deps({ patientStatus: () => Promise.resolve("not_found") })),
    ).rejects.toMatchObject({ data: { code: "patient_not_found" } });
  });

  it("throws patient_inactive for a deactivated patient", async () => {
    await expect(
      resolveAfspraakCreation(deps({ patientStatus: () => Promise.resolve("inactive") })),
    ).rejects.toMatchObject({ data: { code: "patient_inactive" } });
  });

  it("propagates InactiveBehandelsoortError from the behandelsoort gate (BR-12)", async () => {
    await expect(
      resolveAfspraakCreation(
        deps({
          ensureBehandelsoortActive: () => Promise.reject(new InactiveBehandelsoortError()),
        }),
      ),
    ).rejects.toBeInstanceOf(InactiveBehandelsoortError);
  });

  it("throws conflict when an overlap exists and is not acknowledged (AC-8)", async () => {
    const conflicts: AfspraakConflict[] = [
      { afspraakId: "afspraak_x", startDatetime: FUTURE, durationMinutes: 30 },
    ];
    await expect(
      resolveAfspraakCreation(deps({ detectConflicts: () => Promise.resolve(conflicts) })),
    ).rejects.toMatchObject({ data: { code: "conflict" } });
  });

  it("allows save despite a conflict when acknowledged (soft block, A-17)", async () => {
    const conflicts: AfspraakConflict[] = [
      { afspraakId: "afspraak_x", startDatetime: FUTURE, durationMinutes: 30 },
    ];
    const document = await resolveAfspraakCreation(
      deps({ acknowledgeConflict: true, detectConflicts: () => Promise.resolve(conflicts) }),
    );
    expect(document.status).toBe("gepland");
  });

  it("checks rules in order: validation before the patient lookup", async () => {
    let patientChecked = false;
    await expect(
      resolveAfspraakCreation(
        deps({
          input: input({ startDatetime: NOW.getTime() - 1 }),
          patientStatus: () => {
            patientChecked = true;
            return Promise.resolve("active");
          },
        }),
      ),
    ).rejects.toBeInstanceOf(AfspraakCreationError);
    expect(patientChecked).toBe(false);
  });

  it("conflict errors are structured ConvexErrors carrying only ids/times", async () => {
    const conflicts: AfspraakConflict[] = [
      { afspraakId: "afspraak_x", startDatetime: FUTURE, durationMinutes: 30 },
    ];
    await expect(
      resolveAfspraakCreation(deps({ detectConflicts: () => Promise.resolve(conflicts) })),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof ConvexError && (e as ConvexError<{ code: string }>).data.code === "conflict",
    );
  });
});
