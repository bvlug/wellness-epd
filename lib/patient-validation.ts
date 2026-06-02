import { GESLACHT_VALUES } from "../convex/schema";
import { isValidBsn } from "./bsn";

/**
 * Pure, framework-free validation of the new-patient input (Story P-1-S1;
 * FR-1, BR-1, BR-2). This is shared deliberately:
 *
 *  - the Convex `createPatient` mutation runs it as the AUTHORITATIVE gate
 *    (validation must live server-side, never frontend-only — AC-2); and
 *  - the new-patient form runs it for fast, identical client-side feedback.
 *
 * Keeping one implementation means the form and the backend can never disagree
 * about what "valid" means. It is independently unit-tested in
 * `patient-validation.test.ts`.
 *
 * AVG/GDPR (BR-11): the returned error codes/messages reference the FIELD, never
 * the entered value — in particular a bad BSN yields `{ field: "bsn" }` and a
 * generic message, never the number itself. Nothing here logs or throws the
 * input.
 */

/** Controlled `geslacht` vocabulary (BR-1), re-derived from the schema enum. */
export type Geslacht = (typeof GESLACHT_VALUES)[number];

/** The raw, required-and-optional fields the new-patient form collects. */
export interface PatientInput {
  voornaam: string;
  tussenvoegsel?: string;
  achternaam: string;
  /** ISO 8601 calendar date, `YYYY-MM-DD`. */
  geboortedatum: string;
  geslacht: string;
  bsn: string;
  email?: string;
  telefoonnummer?: string;
  notities?: string;
}

/** Fields a validation error can attach to (for inline form display). */
export type PatientField = "voornaam" | "achternaam" | "geboortedatum" | "geslacht" | "bsn";

/** Reason codes a single validation failure can carry. */
export type ValidationCode =
  | "required"
  | "geslacht_invalid"
  | "geboortedatum_invalid"
  | "geboortedatum_not_past"
  | "bsn_invalid";

/**
 * A single, value-free validation failure (BR-11): field + reason code +
 * message. Declared as a `type` (not an `interface`) so it is structurally
 * assignable to Convex's `Value` index-signature constraint when carried inside
 * a {@link import("@/convex/patients").PatientCreationError} payload.
 */
export type ValidationError = {
  field: PatientField;
  code: ValidationCode;
  /** Dutch, user-facing message — never contains the entered value (BR-11). */
  message: string;
};

/** `true` when `value` is one of the controlled `geslacht` literals (BR-1). */
export function isGeslacht(value: string): value is Geslacht {
  return (GESLACHT_VALUES as readonly string[]).includes(value);
}

/**
 * Parse a strict `YYYY-MM-DD` string into a UTC calendar date, or `null` if it
 * is not a real calendar date (e.g. `2026-02-30`). Using UTC and a round-trip
 * check avoids timezone drift and JS `Date` overflow ("2026-02-30" -> March).
 */
function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/**
 * Whether `geboortedatum` is a valid calendar date strictly before `now`'s
 * UTC day (today and any future date are rejected — a birth date cannot be in
 * the future, and "born today" is excluded per the AC's today/future rule).
 */
function isPastDate(value: string, now: Date): boolean {
  const date = parseIsoDate(value);
  if (date === null) {
    return false;
  }
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return date.getTime() < todayUtc;
}

/**
 * Validate a new-patient input. Returns ALL failures (so the form can show
 * every error at once) as a value-free list; an empty array means valid.
 *
 * `now` is injectable so the date rule is deterministic in tests; production
 * callers pass `new Date()`.
 */
export function validatePatientInput(
  input: PatientInput,
  now: Date = new Date(),
): ValidationError[] {
  const errors: ValidationError[] = [];

  if (input.voornaam.trim() === "") {
    errors.push({ field: "voornaam", code: "required", message: "Voornaam is verplicht." });
  }
  if (input.achternaam.trim() === "") {
    errors.push({ field: "achternaam", code: "required", message: "Achternaam is verplicht." });
  }

  if (input.geboortedatum.trim() === "") {
    errors.push({
      field: "geboortedatum",
      code: "required",
      message: "Geboortedatum is verplicht.",
    });
  } else if (parseIsoDate(input.geboortedatum) === null) {
    errors.push({
      field: "geboortedatum",
      code: "geboortedatum_invalid",
      message: "Geboortedatum is geen geldige datum.",
    });
  } else if (!isPastDate(input.geboortedatum, now)) {
    errors.push({
      field: "geboortedatum",
      code: "geboortedatum_not_past",
      message: "Geboortedatum moet in het verleden liggen.",
    });
  }

  if (input.geslacht.trim() === "") {
    errors.push({ field: "geslacht", code: "required", message: "Geslacht is verplicht." });
  } else if (!isGeslacht(input.geslacht)) {
    errors.push({
      field: "geslacht",
      code: "geslacht_invalid",
      message: "Geslacht heeft een ongeldige waarde.",
    });
  }

  if (input.bsn.trim() === "") {
    errors.push({ field: "bsn", code: "required", message: "BSN is verplicht." });
  } else if (!isValidBsn(input.bsn)) {
    // BR-11: never echo the entered BSN — reference the field only.
    errors.push({
      field: "bsn",
      code: "bsn_invalid",
      message: "BSN is ongeldig (controleer het nummer).",
    });
  }

  return errors;
}
