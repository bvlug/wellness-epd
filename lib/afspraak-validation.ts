import type { AFSPRAAK_STATUS_VALUES } from "../convex/schema";

/**
 * Pure, framework-free validation and conflict detection for creating an
 * afspraak (Story A-1-S1; FR-6, FR-12, BR-5). Shared deliberately, exactly like
 * `lib/patient-validation.ts`:
 *
 *  - the Convex `createAfspraak` mutation runs it as the AUTHORITATIVE gate
 *    (validation must live server-side, never frontend-only — AC-2); and
 *  - the new-afspraak form runs it for fast, identical client-side feedback.
 *
 * One implementation means the form and the backend can never disagree about
 * what "valid" or "conflicting" means. Independently unit-tested in
 * `afspraak-validation.test.ts`.
 *
 * Nothing here is patient-identifying: it reasons over ids, timestamps, and
 * durations only — never names, BSNs, or notes — so error/conflict payloads
 * built from it stay PII-free (AC-9 mindset).
 */

/** Default afspraak length when the form leaves duration unset (A-12). */
export const DEFAULT_DURATION_MINUTES = 30;

/** Guard rails for a sane duration (POC): 5 minutes to an 8-hour session. */
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 8 * 60;

/**
 * Afspraak statuses that occupy a behandelaar's calendar and therefore count
 * toward an overlap (FR-12): a `gepland` or `bevestigd` appointment is a real
 * booking, whereas `geannuleerd`/`voltooid` no longer reserve the slot.
 */
export const CONFLICT_STATUSES: readonly string[] = ["gepland", "bevestigd"];

// Compile-time assurance that the conflict statuses are real schema statuses.
const _conflictStatusesAreValid: readonly (typeof AFSPRAAK_STATUS_VALUES)[number][] = [
  "gepland",
  "bevestigd",
];
void _conflictStatusesAreValid;

/** Raw create-afspraak input the form collects and the mutation receives. */
export interface AfspraakInput {
  patientId: string;
  behandelaarId: string;
  /** Epoch milliseconds of the appointment start. */
  startDatetime: number;
  durationMinutes: number;
  behandelsoortId?: string;
  notities?: string;
}

/** Fields a validation error can attach to (for inline form display). */
export type AfspraakField = "patientId" | "behandelaarId" | "startDatetime" | "durationMinutes";

/** Reason codes a single validation failure can carry. */
export type AfspraakValidationCode = "required" | "start_not_future" | "duration_invalid";

/** A single, PII-free validation failure: field + reason code + Dutch message. */
export type AfspraakValidationError = {
  field: AfspraakField;
  code: AfspraakValidationCode;
  /** Dutch, user-facing message — never contains patient data. */
  message: string;
};

/**
 * Validate create-afspraak input. Returns ALL failures so the form can show
 * every error at once; an empty array means valid. `now` is injectable so the
 * future-date rule (BR-5) is deterministic in tests; production passes
 * `new Date()`.
 *
 * Referential rules that need the database — patient exists & is active, the
 * behandelsoort is active (BR-12), the behandelaar is an active behandelaar
 * (BR-7) — are NOT here; they live in the mutation/action which can read Convex
 * and Clerk. This function covers only what is decidable from the input itself.
 */
export function validateAfspraakInput(
  input: AfspraakInput,
  now: Date = new Date(),
): AfspraakValidationError[] {
  const errors: AfspraakValidationError[] = [];

  if (input.patientId.trim() === "") {
    errors.push({ field: "patientId", code: "required", message: "Selecteer een patiënt." });
  }
  if (input.behandelaarId.trim() === "") {
    errors.push({
      field: "behandelaarId",
      code: "required",
      message: "Selecteer een behandelaar.",
    });
  }

  if (!Number.isFinite(input.startDatetime)) {
    errors.push({
      field: "startDatetime",
      code: "required",
      message: "Kies een datum en tijd.",
    });
  } else if (input.startDatetime <= now.getTime()) {
    // BR-5: a new afspraak cannot start in the past (or exactly now).
    errors.push({
      field: "startDatetime",
      code: "start_not_future",
      message: "De datum en tijd moeten in de toekomst liggen.",
    });
  }

  if (
    !Number.isInteger(input.durationMinutes) ||
    input.durationMinutes < MIN_DURATION_MINUTES ||
    input.durationMinutes > MAX_DURATION_MINUTES
  ) {
    errors.push({
      field: "durationMinutes",
      code: "duration_invalid",
      message: "De duur is ongeldig.",
    });
  }

  return errors;
}

/** An existing afspraak, reduced to the fields conflict detection needs. */
export interface ExistingAfspraak {
  _id: string;
  startDatetime: number;
  durationMinutes: number;
  status: string;
}

/**
 * A detected overlap, PII-free: only the other afspraak's id and time window.
 * Declared as a `type` (not an `interface`) so it is structurally assignable to
 * Convex's `Value` index-signature constraint when carried inside an
 * {@link import("@/convex/afspraken").AfspraakCreationError} payload.
 */
export type AfspraakConflict = {
  afspraakId: string;
  startDatetime: number;
  durationMinutes: number;
};

/** End-of-slot epoch ms for a start + duration (minutes). */
function endOf(startDatetime: number, durationMinutes: number): number {
  return startDatetime + durationMinutes * 60_000;
}

/**
 * Do two time slots overlap? Half-open intervals [start, end): two slots overlap
 * iff each starts before the other ends, so back-to-back appointments (one ends
 * exactly when the next begins) do NOT count as a conflict.
 */
export function slotsOverlap(
  startA: number,
  durationA: number,
  startB: number,
  durationB: number,
): boolean {
  return startA < endOf(startB, durationB) && startB < endOf(startA, durationA);
}

/**
 * Find every existing afspraak that conflicts with a candidate slot (FR-12):
 * one whose status still reserves the calendar ({@link CONFLICT_STATUSES}) and
 * whose time window overlaps the candidate's. Returns PII-free conflict descriptors.
 * The caller is expected to pass only the same behandelaar's afspraken — this
 * function does not re-check the behandelaar id (the DB query scopes that).
 */
export function findConflicts(
  candidateStart: number,
  candidateDuration: number,
  existing: readonly ExistingAfspraak[],
): AfspraakConflict[] {
  const conflicts: AfspraakConflict[] = [];
  for (const afspraak of existing) {
    if (!CONFLICT_STATUSES.includes(afspraak.status)) {
      continue;
    }
    if (
      slotsOverlap(
        candidateStart,
        candidateDuration,
        afspraak.startDatetime,
        afspraak.durationMinutes,
      )
    ) {
      conflicts.push({
        afspraakId: afspraak._id,
        startDatetime: afspraak.startDatetime,
        durationMinutes: afspraak.durationMinutes,
      });
    }
  }
  return conflicts;
}
