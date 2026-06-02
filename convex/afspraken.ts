import { mutationGeneric } from "convex/server";
import { ConvexError, type GenericId, v } from "convex/values";
import {
  type AfspraakConflict,
  type AfspraakInput,
  type AfspraakValidationError,
  DEFAULT_DURATION_MINUTES,
  type ExistingAfspraak,
  findConflicts,
  validateAfspraakInput,
} from "../lib/afspraak-validation";
import { type AuditMutationContext, logAudit } from "./audit";
import { type AuthContext, type Role, assertHasRole } from "./auth";
import {
  type BehandelsoortDoc,
  type BehandelsoortReader,
  assertActiveBehandelsoort,
} from "./behandelsoort";

/**
 * Afspraak creation (Story A-1-S1; FR-6, FR-12, BR-5, BR-12, AC-2, AC-8, AC-9).
 * This is the AUTHORITATIVE create path: every rule is enforced here on the
 * server regardless of what the form does. The flow, strictly in order:
 *
 *   1. Authorize: only `balie` or `admin` may create afspraken (AC-2); a
 *      `behandelaar`-only caller is denied BEFORE any data access via
 *      {@link assertHasRole}.
 *   2. Validate the input (future start/BR-5, sane duration) with the SAME pure
 *      {@link validateAfspraakInput} the form uses.
 *   3. Patient must exist and be active (a deactivated patient cannot be booked).
 *   4. If a behandelsoort is supplied it must be active (BR-12) — reusing
 *      {@link assertActiveBehandelsoort} from Story B-3-S1 (#18).
 *   5. Conflict check (FR-12, AC-8): overlap against the same behandelaar's
 *      `gepland`/`bevestigd` afspraken is a SOFT block (A-17) — surfaced as a
 *      warning the caller can override with `acknowledgeConflict: true`, exactly
 *      like the duplicate-BSN flow in `convex/patients.ts`.
 *   6. Insert with status `gepland`, then write a PII-free `create` audit entry
 *      (AC-9) in the same transaction (BR-13).
 *
 * The new afspraak shows up in the agenda automatically: Convex queries are
 * reactive, so the agenda view (#34) re-runs on insert — no extra work here.
 *
 * Nothing here carries patient-identifying data into errors, logs, or the audit
 * entry: validation errors are field/code only, the conflict payload is ids and
 * times, and {@link logAudit} is structurally PII-incapable.
 */

/** Roles permitted to create an afspraak (FR-6; AC-2 denies behandelaar). */
const CREATE_ROLES: readonly Role[] = ["balie", "admin"];

/**
 * How far back to scan a behandelaar's afspraken when looking for overlaps. A
 * generous day exceeds the max afspraak length, so any earlier appointment that
 * could still be running by the candidate's start is included; {@link findConflicts}
 * then applies the exact half-open overlap test.
 */
const CONFLICT_LOOKBACK_MS = 24 * 60 * 60_000;

/**
 * Structured, PII-free application error for a failed creation. Modeled as a
 * {@link ConvexError} so the client can branch on `code`. The conflict payload
 * carries only the overlapping afspraken's ids and time windows — never patient
 * data (AC-9). (An inactive behandelsoort surfaces as the dedicated
 * `InactiveBehandelsoortError` from #18, whose code is `inactive_behandelsoort`.)
 */
export type AfspraakCreationErrorData =
  | { code: "validation_failed"; errors: AfspraakValidationError[] }
  | { code: "patient_not_found" }
  | { code: "patient_inactive" }
  | { code: "conflict"; conflicts: AfspraakConflict[] };

export class AfspraakCreationError extends ConvexError<AfspraakCreationErrorData> {
  constructor(data: AfspraakCreationErrorData) {
    super(data);
    this.name = "AfspraakCreationError";
  }
}

/** The persisted afspraak document (minus Convex system fields). Always `gepland`. */
export interface AfspraakDocument {
  patientId: GenericId<"patient">;
  behandelaarId: string;
  startDatetime: number;
  durationMinutes: number;
  behandelsoortId?: GenericId<"behandelsoort">;
  notities?: string;
  status: "gepland";
}

/** Trim and drop an optional string when empty, so we never store `""`. */
function optionalTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Pure mapping from validated input to the document we insert (status fixed to
 * `gepland`, FR-6). ASSUMES the input already passed {@link validateAfspraakInput}.
 * Extracted so the field mapping is unit-testable without a Convex runtime.
 */
export function buildAfspraakDocument(input: AfspraakInput): AfspraakDocument {
  const document: AfspraakDocument = {
    patientId: input.patientId as GenericId<"patient">,
    behandelaarId: input.behandelaarId,
    startDatetime: input.startDatetime,
    durationMinutes: input.durationMinutes,
    status: "gepland",
  };
  if (input.behandelsoortId !== undefined && input.behandelsoortId !== "") {
    document.behandelsoortId = input.behandelsoortId as GenericId<"behandelsoort">;
  }
  const notities = optionalTrimmed(input.notities);
  if (notities !== undefined) {
    document.notities = notities;
  }
  return document;
}

/** The patient's existence/active state, as the creation core needs it. */
export type PatientStatus = "active" | "inactive" | "not_found";

/**
 * Core creation decision, decoupled from Convex so every rule is unit-testable
 * offline. Runs validation → patient gate → behandelsoort gate → conflict gate,
 * then returns the document to insert, or throws an {@link AfspraakCreationError}
 * (or {@link import("./behandelsoort").InactiveBehandelsoortError}). The Convex
 * handler wires the real `db`/`auth`/`logAudit` around it.
 *
 * `acknowledgeConflict` turns the overlap block into a no-op (soft block, A-17):
 * the caller chose to double-book after seeing the warning.
 */
export async function resolveAfspraakCreation(args: {
  input: AfspraakInput;
  acknowledgeConflict: boolean;
  patientStatus: () => Promise<PatientStatus>;
  ensureBehandelsoortActive: () => Promise<void>;
  detectConflicts: () => Promise<AfspraakConflict[]>;
  now?: Date;
}): Promise<AfspraakDocument> {
  const validationErrors = validateAfspraakInput(args.input, args.now);
  if (validationErrors.length > 0) {
    throw new AfspraakCreationError({ code: "validation_failed", errors: validationErrors });
  }

  const status = await args.patientStatus();
  if (status === "not_found") {
    throw new AfspraakCreationError({ code: "patient_not_found" });
  }
  if (status === "inactive") {
    throw new AfspraakCreationError({ code: "patient_inactive" });
  }

  // BR-12: throws InactiveBehandelsoortError if a supplied behandelsoort is inactive.
  await args.ensureBehandelsoortActive();

  const conflicts = await args.detectConflicts();
  if (conflicts.length > 0 && !args.acknowledgeConflict) {
    throw new AfspraakCreationError({ code: "conflict", conflicts });
  }

  return buildAfspraakDocument(args.input);
}

/**
 * The Convex `db` slice this mutation needs: fetch a patient/behandelsoort by id
 * (both documents expose `actief`), range-scan a behandelaar's afspraken via the
 * `by_behandelaar_and_start` index, and insert. Declared narrowly (like the
 * patient mutation) so the handler typechecks before codegen and stays testable.
 */
interface AfspraakMutationContext extends AuthContext, AuditMutationContext {
  db: AuditMutationContext["db"] & {
    get: (
      id: GenericId<"patient"> | GenericId<"behandelsoort">,
    ) => Promise<({ actief: boolean } & Partial<BehandelsoortDoc>) | null>;
    query: (table: "afspraak") => {
      withIndex: (
        index: "by_behandelaar_and_start",
        range: (q: {
          eq: (
            field: "behandelaarId",
            value: string,
          ) => {
            gte: (
              field: "startDatetime",
              value: number,
            ) => {
              lt: (field: "startDatetime", value: number) => unknown;
            };
          };
        }) => unknown,
      ) => { collect: () => Promise<ExistingAfspraak[]> };
    };
    insert: (table: "afspraak", document: AfspraakDocument) => Promise<string>;
  };
}

export const createAfspraak = mutationGeneric({
  args: {
    patientId: v.id("patient"),
    behandelaarId: v.string(),
    startDatetime: v.number(),
    durationMinutes: v.optional(v.number()),
    behandelsoortId: v.optional(v.id("behandelsoort")),
    notities: v.optional(v.string()),
    acknowledgeConflict: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // 1. Authorize: balie OR admin only (AC-2). Denies before any data access.
    await assertHasRole(ctx as AuthContext, CREATE_ROLES);

    const mutationCtx = ctx as unknown as AfspraakMutationContext;
    const durationMinutes = args.durationMinutes ?? DEFAULT_DURATION_MINUTES;
    const startDatetime = args.startDatetime;

    const document = await resolveAfspraakCreation({
      input: {
        patientId: args.patientId,
        behandelaarId: args.behandelaarId,
        startDatetime,
        durationMinutes,
        behandelsoortId: args.behandelsoortId,
        notities: args.notities,
      },
      acknowledgeConflict: args.acknowledgeConflict ?? false,
      patientStatus: async () => {
        const patient = await mutationCtx.db.get(args.patientId);
        if (patient === null) {
          return "not_found";
        }
        return patient.actief ? "active" : "inactive";
      },
      // BR-12: reuse the #18 validator (throws InactiveBehandelsoortError).
      ensureBehandelsoortActive: async () => {
        if (args.behandelsoortId !== undefined) {
          const reader: BehandelsoortReader = {
            get: (id) => mutationCtx.db.get(id) as unknown as Promise<BehandelsoortDoc | null>,
          };
          await assertActiveBehandelsoort(reader, args.behandelsoortId);
        }
      },
      detectConflicts: async () => {
        const windowStart = startDatetime - CONFLICT_LOOKBACK_MS;
        const windowEnd = startDatetime + durationMinutes * 60_000;
        const existing = await mutationCtx.db
          .query("afspraak")
          .withIndex("by_behandelaar_and_start", (q) =>
            q
              .eq("behandelaarId", args.behandelaarId)
              .gte("startDatetime", windowStart)
              .lt("startDatetime", windowEnd),
          )
          .collect();
        return findConflicts(startDatetime, durationMinutes, existing);
      },
    });

    const afspraakId = await mutationCtx.db.insert("afspraak", document);

    // AC-9: PII-free audit entry, after the insert, in the same transaction.
    await logAudit(mutationCtx, {
      action: "create",
      resourceType: "afspraak",
      resourceId: afspraakId,
    });

    return { afspraakId };
  },
});
