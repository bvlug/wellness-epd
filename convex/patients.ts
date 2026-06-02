import { mutationGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import { normalizeBsn } from "../lib/bsn";
import {
  type PatientInput,
  type ValidationError,
  validatePatientInput,
} from "../lib/patient-validation";
import { type AuditMutationContext, logAudit } from "./audit";
import { type AuthContext, type Role, assertHasRole, getRoles } from "./auth";
import { GESLACHT_VALUES } from "./schema";

/**
 * Patient creation (Story P-1-S1; FR-1, BR-1, BR-2, BR-3, BR-11, EH-4, AC-2,
 * AC-9). This is the AUTHORITATIVE create path: every rule is enforced here on
 * the server, regardless of what the form does (the form's identical checks are
 * convenience only). The flow is, strictly in order:
 *
 *   1. Authorize the caller: `balie` OR `admin` may create (FR-1); anyone else
 *      (e.g. a `behandelaar`-only caller) is denied BEFORE any data access
 *      (AC-2), via the shared {@link assertHasRole} guard.
 *   2. Validate the input server-side (required fields, geslacht ∈ controlled
 *      vocabulary, geboortedatum a real past date, BSN Elfproef) using the same
 *      pure {@link validatePatientInput} the form uses (BR-1, BR-2).
 *   3. Duplicate-BSN check among ACTIVE patients via the `by_bsn` index (EH-4):
 *      if one exists, do NOT save — surface a duplicate warning. Saving anyway
 *      requires an explicit `acknowledgeDuplicate: true` AND the `admin` role
 *      (A-25); a balie cannot override a duplicate.
 *   4. Insert the patient, then write a PII-free `create` audit entry (AC-9).
 *
 * **AVG/GDPR (BR-11).** The BSN is patient-identifying data. No code path here
 * logs, prints, or throws the BSN value: validation errors carry a field + code
 * only, the duplicate error names no value, and {@link logAudit} is structurally
 * incapable of receiving PII. The stored `bsn` is the normalized digit string.
 */

/** Roles permitted to create a patient (FR-1). */
const CREATE_ROLES: readonly Role[] = ["balie", "admin"];

/** Role required to override a duplicate-BSN block by acknowledging it (A-25). */
const DUPLICATE_OVERRIDE_ROLE: Role = "admin";

/**
 * Structured, PII-free application error for a failed creation. Modeled as a
 * {@link ConvexError} so Convex surfaces it to the client as data (not a 500)
 * and the form can branch on `code`. The payload NEVER carries the entered
 * value (BR-11): validation errors are a field/code list; the duplicate case is
 * a bare flag plus whether the caller could override it.
 */
export type PatientCreationErrorData =
  | { code: "validation_failed"; errors: ValidationError[] }
  | { code: "duplicate_bsn"; canOverride: boolean };

export class PatientCreationError extends ConvexError<PatientCreationErrorData> {
  constructor(data: PatientCreationErrorData) {
    super(data);
    this.name = "PatientCreationError";
  }
}

/**
 * The persisted patient document shape (minus Convex's system fields). Optional
 * contact fields are included only when non-empty so we never store empty
 * strings. `actief` is always `true` for a freshly created record (BR-3).
 */
export interface PatientDocument {
  voornaam: string;
  tussenvoegsel?: string;
  achternaam: string;
  geboortedatum: string;
  geslacht: (typeof GESLACHT_VALUES)[number];
  bsn: string;
  email?: string;
  telefoonnummer?: string;
  notities?: string;
  actief: true;
}

/** Trim and drop an optional string when it is empty, so we never store `""`. */
function optionalTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Pure mapping from validated input to the document we insert. ASSUMES the
 * input already passed {@link validatePatientInput}; it normalizes/trims the
 * stored values. The BSN is stored in its CANONICAL nine-digit form via
 * {@link normalizeBsn} — never the raw entry — so that the persisted value and
 * the `by_bsn` duplicate lookup are always comparing the same canonical string
 * (a BSN typed without a leading zero must collide with the stored zero-padded
 * one; EH-4). Validation guarantees `normalizeBsn` succeeds here; the `?? trim`
 * is a defensive fallback that never runs for validated input. Extracted so the
 * field mapping is unit-testable without a Convex runtime.
 */
export function buildPatientDocument(input: PatientInput): PatientDocument {
  return {
    voornaam: input.voornaam.trim(),
    tussenvoegsel: optionalTrimmed(input.tussenvoegsel),
    achternaam: input.achternaam.trim(),
    geboortedatum: input.geboortedatum.trim(),
    // Safe: validation guarantees one of GESLACHT_VALUES.
    geslacht: input.geslacht.trim() as (typeof GESLACHT_VALUES)[number],
    bsn: normalizeBsn(input.bsn) ?? input.bsn.trim(),
    email: optionalTrimmed(input.email),
    telefoonnummer: optionalTrimmed(input.telefoonnummer),
    notities: optionalTrimmed(input.notities),
    actief: true,
  };
}

/**
 * Whether a caller holding `roles` may override a duplicate-BSN block. Only an
 * `admin` may, and only with an explicit acknowledgement (A-25). Pure and
 * unit-testable.
 */
export function canOverrideDuplicate(
  roles: readonly Role[],
  acknowledgeDuplicate: boolean,
): boolean {
  return acknowledgeDuplicate && roles.includes(DUPLICATE_OVERRIDE_ROLE);
}

/**
 * Minimal active-patient lister for the duplicate check, declared locally so the
 * decision logic is testable without a Convex runtime. Returns whether any
 * ACTIVE patient already holds the given (normalized) BSN.
 */
type ActiveBsnExists = (bsn: string) => Promise<boolean>;

/**
 * Core creation decision, decoupled from Convex. Runs validation → duplicate
 * gate → returns the document to insert, or throws a {@link PatientCreationError}.
 * The Convex handler wires the real `db`/`auth`/`logAudit` around this.
 *
 * `acknowledgeDuplicate` is honored ONLY for admins (A-25): a balie that sets it
 * still gets the duplicate block. The error tells the client whether the CURRENT
 * caller could override, so the form shows an admin-only acknowledge affordance.
 */
export async function resolvePatientCreation(args: {
  input: PatientInput;
  roles: readonly Role[];
  acknowledgeDuplicate: boolean;
  activeBsnExists: ActiveBsnExists;
  now?: Date;
}): Promise<PatientDocument> {
  const validationErrors = validatePatientInput(args.input, args.now);
  if (validationErrors.length > 0) {
    throw new PatientCreationError({ code: "validation_failed", errors: validationErrors });
  }

  const document = buildPatientDocument(args.input);

  const duplicate = await args.activeBsnExists(document.bsn);
  if (duplicate && !canOverrideDuplicate(args.roles, args.acknowledgeDuplicate)) {
    // BR-11: no BSN value in the payload — only the fact + override capability.
    throw new PatientCreationError({
      code: "duplicate_bsn",
      canOverride: args.roles.includes(DUPLICATE_OVERRIDE_ROLE),
    });
  }

  return document;
}

/**
 * Convex `db` slice this mutation needs: the indexed `by_bsn` query (for the
 * active-duplicate check) plus an insert. Declared narrowly; the audit writer
 * brings its own insert contract.
 */
interface PatientMutationContext extends AuthContext, AuditMutationContext {
  db: AuditMutationContext["db"] & {
    insert: (table: "patient", document: PatientDocument) => Promise<string>;
    query: (table: "patient") => {
      withIndex: (
        index: "by_bsn",
        range: (q: { eq: (field: "bsn", value: string) => unknown }) => unknown,
      ) => { collect: () => Promise<Array<{ actief: boolean }>> };
    };
  };
}

/**
 * Validators for the create arguments. The patient fields mirror the schema
 * (`geslacht` re-uses the controlled vocabulary as a `v.union` of literals);
 * `acknowledgeDuplicate` is an optional admin-only override flag (A-25). String
 * fields are accepted loosely and re-validated by {@link validatePatientInput};
 * the Convex validator only fixes presence and primitive type.
 */
const geslachtValidator = v.union(...GESLACHT_VALUES.map((value) => v.literal(value)));

export const createPatient = mutationGeneric({
  args: {
    voornaam: v.string(),
    tussenvoegsel: v.optional(v.string()),
    achternaam: v.string(),
    geboortedatum: v.string(),
    geslacht: geslachtValidator,
    bsn: v.string(),
    email: v.optional(v.string()),
    telefoonnummer: v.optional(v.string()),
    notities: v.optional(v.string()),
    acknowledgeDuplicate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Authorize: balie OR admin only (FR-1, AC-2). Denies before any read.
    const identity = await assertHasRole(ctx as AuthContext, CREATE_ROLES);
    const roles = getRoles(identity);

    const mutationCtx = ctx as unknown as PatientMutationContext;

    // 2-3. Validate + duplicate gate (pure core), 4. then insert.
    const document = await resolvePatientCreation({
      input: {
        voornaam: args.voornaam,
        tussenvoegsel: args.tussenvoegsel,
        achternaam: args.achternaam,
        geboortedatum: args.geboortedatum,
        geslacht: args.geslacht,
        bsn: args.bsn,
        email: args.email,
        telefoonnummer: args.telefoonnummer,
        notities: args.notities,
      },
      roles,
      acknowledgeDuplicate: args.acknowledgeDuplicate ?? false,
      activeBsnExists: async (bsn) => {
        const matches = await mutationCtx.db
          .query("patient")
          .withIndex("by_bsn", (q) => q.eq("bsn", bsn))
          .collect();
        return matches.some((patient) => patient.actief);
      },
    });

    const patientId = await mutationCtx.db.insert("patient", document);

    // AC-9: PII-free audit entry, after the insert, in the same transaction.
    await logAudit(mutationCtx, {
      action: "create",
      resourceType: "patient",
      resourceId: patientId,
    });

    return { patientId };
  },
});
