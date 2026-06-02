import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, type GenericId, v } from "convex/values";
import { normalizeBsn } from "../lib/bsn";
import {
  type PatientInput,
  type ValidationError,
  validatePatientInput,
} from "../lib/patient-validation";
import { type AuditMutationContext, logAudit } from "./audit";
import { type AuthContext, type Role, assertHasRole, getRoles, requireIdentity } from "./auth";
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

/* -------------------------------------------------------------------------- */
/* Patient search (Story P-2-S1; FR-4, BR-4, BR-11, EH-1, A-10, AC-9).        */
/* -------------------------------------------------------------------------- */

/**
 * Patient search (Story P-2-S1). This is the AUTHORITATIVE, server-side read
 * path: any authenticated staff member may search ({@link requireIdentity}),
 * and every search rule is enforced here, never trusted to the form. The rules,
 * in order:
 *
 *   - **BR-4 — no blanket list.** If the caller supplies no usable criteria, the
 *     query returns `[]` immediately and never reads the patient table. The
 *     search screen is not a way to enumerate every patient.
 *   - **EH-1 — active-only, no inactive leak.** Deactivated patients
 *     (`actief = false`) are excluded unless an explicit `includeInactive` flag
 *     is passed. A BSN that matches only a deactivated record yields ZERO
 *     results, and the response shape is identical to "no match at all" — the
 *     caller cannot tell that the BSN exists on an inactive record.
 *   - **A-10 — capped.** At most {@link SEARCH_RESULT_LIMIT} results are returned.
 *   - **BSN parity.** A BSN search key is canonicalized with the SAME
 *     {@link normalizeBsn} used when the BSN is stored (#19), so a value typed
 *     without its leading zero still matches the zero-padded stored value via the
 *     `by_bsn` index.
 *   - **BR-11 — BSN never logged.** No code path here `console.*`-logs or throws
 *     the BSN value; results carry no BSN at all.
 *
 * Each result is intentionally minimal — `achternaam`, `voornaam`,
 * `geboortedatum`, and the patient id — exactly the columns the results list
 * shows and enough to link through to the profile. The BSN is deliberately NOT
 * returned. The AC-9 "click-through writes a view audit" requirement is NOT
 * satisfied here: it lives on the patient-profile view path owned by #20; this
 * query only locates patients and the UI links to that path.
 */

/** A-10: the maximum number of search results returned in one response. */
export const SEARCH_RESULT_LIMIT = 50;

/**
 * Internal scan ceiling. When a name/dob-only search has to range-scan the
 * `by_achternaam` index (no exact BSN to point-look-up), we read at most this
 * many candidate rows before filtering down to {@link SEARCH_RESULT_LIMIT}. It
 * is a POC-scale guard against an unbounded table scan; with more data this
 * would become a dedicated Convex search index.
 */
const SEARCH_SCAN_LIMIT = 500;

/** Raw, loosely-typed search criteria as they arrive from the form. */
export interface PatientSearchCriteria {
  achternaam?: string;
  voornaam?: string;
  geboortedatum?: string;
  bsn?: string;
}

/**
 * Criteria after trimming/canonicalization. `bsn` is the {@link normalizeBsn}
 * canonical form (or `undefined` when blank/non-numeric); the name fields are
 * trimmed and lower-cased for case-insensitive matching; `geboortedatum` is
 * trimmed. A field is present only when it carries a usable value, so
 * {@link hasUsableCriteria} can decide BR-4 from this shape alone.
 */
export interface NormalizedSearchCriteria {
  achternaam?: string;
  voornaam?: string;
  geboortedatum?: string;
  bsn?: string;
}

/** The PII-minimal shape returned per match (no BSN; BR-11). */
export interface PatientSearchResult {
  patientId: string;
  achternaam: string;
  voornaam: string;
  geboortedatum: string;
}

/** The minimal patient fields the search core needs to match and project. */
export interface SearchablePatient {
  _id: string;
  achternaam: string;
  voornaam: string;
  geboortedatum: string;
  bsn: string;
  actief: boolean;
}

/** Trim a loose string and drop it when empty. */
function trimmedOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Normalize raw criteria: trim/lower-case the name fields, trim geboortedatum,
 * and canonicalize the BSN through {@link normalizeBsn} so the search key and
 * the stored value share one canonical form (leading-zero parity). A BSN that
 * is blank or not all-digits becomes `undefined` (no BSN criterion), never an
 * error that could echo the value (BR-11).
 */
export function normalizeSearchCriteria(criteria: PatientSearchCriteria): NormalizedSearchCriteria {
  const achternaam = trimmedOrUndefined(criteria.achternaam)?.toLowerCase();
  const voornaam = trimmedOrUndefined(criteria.voornaam)?.toLowerCase();
  const geboortedatum = trimmedOrUndefined(criteria.geboortedatum);
  const rawBsn = trimmedOrUndefined(criteria.bsn);
  const bsn = rawBsn === undefined ? undefined : (normalizeBsn(rawBsn) ?? undefined);
  return { achternaam, voornaam, geboortedatum, bsn };
}

/**
 * BR-4: whether the caller supplied at least one usable criterion. When this is
 * false the query must return `[]` and never read the patient table.
 */
export function hasUsableCriteria(criteria: NormalizedSearchCriteria): boolean {
  return (
    criteria.achternaam !== undefined ||
    criteria.voornaam !== undefined ||
    criteria.geboortedatum !== undefined ||
    criteria.bsn !== undefined
  );
}

/**
 * Pure predicate: does a patient match ALL supplied criteria? Name fields match
 * as case-insensitive PREFIXES (partial achternaam/voornaam), BSN and
 * geboortedatum match EXACTLY. Active/inactive filtering is handled separately
 * by the caller (so EH-1 stays an explicit, visible step), not here.
 */
export function matchesCriteria(
  patient: SearchablePatient,
  criteria: NormalizedSearchCriteria,
): boolean {
  if (criteria.bsn !== undefined && patient.bsn !== criteria.bsn) {
    return false;
  }
  if (
    criteria.achternaam !== undefined &&
    !patient.achternaam.toLowerCase().startsWith(criteria.achternaam)
  ) {
    return false;
  }
  if (
    criteria.voornaam !== undefined &&
    !patient.voornaam.toLowerCase().startsWith(criteria.voornaam)
  ) {
    return false;
  }
  if (criteria.geboortedatum !== undefined && patient.geboortedatum !== criteria.geboortedatum) {
    return false;
  }
  return true;
}

/** Project a matched patient to the PII-minimal result shape (no BSN; BR-11). */
function toResult(patient: SearchablePatient): PatientSearchResult {
  return {
    patientId: patient._id,
    achternaam: patient.achternaam,
    voornaam: patient.voornaam,
    geboortedatum: patient.geboortedatum,
  };
}

/**
 * Pure search core, decoupled from Convex so every rule is unit-testable
 * offline. Given already-normalized criteria and a fetched candidate list,
 * applies: BR-4 (empty → `[]`), EH-1 (drop `actief === false` unless
 * `includeInactive`), the criteria predicate, and the A-10 cap.
 *
 * The Convex handler is responsible only for choosing WHICH candidates to fetch
 * (a `by_bsn` point lookup vs. a bounded `by_achternaam`/table scan) and for not
 * fetching at all when {@link hasUsableCriteria} is false — but this function
 * re-checks emptiness too, so the rule holds regardless of caller.
 */
export function resolvePatientSearch(args: {
  criteria: NormalizedSearchCriteria;
  candidates: readonly SearchablePatient[];
  includeInactive: boolean;
  limit?: number;
}): PatientSearchResult[] {
  if (!hasUsableCriteria(args.criteria)) {
    return [];
  }
  const limit = args.limit ?? SEARCH_RESULT_LIMIT;
  const results: PatientSearchResult[] = [];
  for (const patient of args.candidates) {
    if (!args.includeInactive && !patient.actief) {
      continue;
    }
    if (!matchesCriteria(patient, args.criteria)) {
      continue;
    }
    results.push(toResult(patient));
    if (results.length >= limit) {
      break;
    }
  }
  return results;
}

/**
 * The Convex `db` slice the search query needs: a `by_bsn` point lookup and a
 * `by_achternaam` range scan over the patient table. Declared narrowly (like
 * the create mutation's context) so the handler typechecks before codegen and
 * stays unit-test-friendly.
 */
interface PatientQueryContext extends AuthContext {
  db: {
    query: (table: "patient") => {
      withIndex: (
        index: "by_bsn" | "by_achternaam",
        range: (q: {
          eq: (field: "bsn", value: string) => unknown;
        }) => unknown,
      ) => { take: (n: number) => Promise<SearchablePatient[]> };
    };
  };
}

/**
 * Authoritative patient-search query (FR-4). Authorizes any authenticated staff
 * member, normalizes the criteria, and — only if a usable criterion is present —
 * fetches a bounded candidate set and runs it through {@link resolvePatientSearch}.
 *
 * Fetch strategy:
 *   - **BSN given:** a `by_bsn` point lookup on the canonical key — at most a
 *     handful of rows, then the active-only/EH-1 filter drops a deactivated hit
 *     so it returns zero results indistinguishably from "no such BSN".
 *   - **No BSN:** a bounded `by_achternaam` scan (up to {@link SEARCH_SCAN_LIMIT}
 *     rows) feeds the in-memory prefix/exact filter. Bounded so the query can
 *     never turn into an unbounded table scan (a real search index would replace
 *     this past POC scale).
 *
 * BR-11: the BSN is used only as an opaque lookup key; it is never logged and is
 * absent from every result.
 */
export const searchPatients = queryGeneric({
  args: {
    achternaam: v.optional(v.string()),
    voornaam: v.optional(v.string()),
    geboortedatum: v.optional(v.string()),
    bsn: v.optional(v.string()),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    // Any authenticated staff member may search (FR-4). Fails closed (EH-7).
    await requireIdentity(ctx as AuthContext);

    const criteria = normalizeSearchCriteria({
      achternaam: args.achternaam,
      voornaam: args.voornaam,
      geboortedatum: args.geboortedatum,
      bsn: args.bsn,
    });

    // BR-4: no usable criteria → return nothing without touching the table.
    if (!hasUsableCriteria(criteria)) {
      return [];
    }

    const queryCtx = ctx as unknown as PatientQueryContext;

    let candidates: SearchablePatient[];
    if (criteria.bsn !== undefined) {
      // Exact-BSN point lookup on the canonical key (leading-zero parity).
      const bsnKey = criteria.bsn;
      candidates = await queryCtx.db
        .query("patient")
        .withIndex("by_bsn", (q) => q.eq("bsn", bsnKey))
        .take(SEARCH_RESULT_LIMIT);
    } else {
      // Bounded scan ordered by achternaam; the in-memory predicate applies the
      // case-insensitive prefix / exact-dob match.
      candidates = await queryCtx.db
        .query("patient")
        .withIndex("by_achternaam", () => undefined)
        .take(SEARCH_SCAN_LIMIT);
    }

    return resolvePatientSearch({
      criteria,
      candidates,
      includeInactive: args.includeInactive ?? false,
    });
  },
});

/* -------------------------------------------------------------------------- */
/* View patient profile (Story P-1-S2; FR-3, AC-1, AC-9, BR-3, BR-11)         */
/* -------------------------------------------------------------------------- */

/**
 * The patient profile view path.
 *
 * **Why this is a `mutation`, not a `query`.** AC-9 requires that opening a
 * patient profile writes a `view` audit entry, and AC-7 (#17) documents that a
 * Convex **query is read-only** — it cannot insert an audit entry. A profile
 * view therefore both READS the patient and WRITES an audit row, which is only
 * possible from a `mutation` (or `action`). We model it as a single `mutation`,
 * {@link getPatientForView}, so the read and the audit write happen atomically
 * in one Convex transaction: if the audit insert fails, the whole call rolls
 * back and the caller gets no patient data either (you cannot view without being
 * audited). The frontend fires this once when the profile page loads.
 *
 * **Authorization (FR-3 / AC-1).** Any authenticated staff member (behandelaar,
 * balie, or admin) may view a profile, so this path authorizes via
 * {@link requireIdentity} only — no role gate. Crucially, {@link requireIdentity}
 * runs FIRST, before any `db` read, so an unauthenticated caller throws
 * {@link import("./auth").UnauthenticatedError} and receives NO patient data
 * (AC-1). Route middleware redirecting the browser to sign-in is convenience;
 * this server check is the real boundary.
 *
 * **BSN / AVG (BR-3 / BR-11).** The full patient record — including the full BSN
 * — is returned to the authorized staff member by design (BR-3). The audit
 * entry remains PII-free: {@link logAudit} accepts only enums plus the opaque
 * patient id, so no name/BSN is ever written to the audit trail (BR-11).
 */

/** A persisted afspraak row, as read for the upcoming-afspraken summary. */
export interface AfspraakSummary {
  _id: GenericId<"afspraak">;
  startDatetime: number;
  durationMinutes: number;
  status: string;
  behandelaarId: string;
  behandelsoortId?: GenericId<"behandelsoort">;
}

/** A persisted behandeling row, as read for the recent-behandelingen summary. */
export interface BehandelingSummary {
  _id: GenericId<"behandeling">;
  treatmentDate: string;
  behandelaarId: string;
  behandelsoortId: GenericId<"behandelsoort">;
  status: string;
}

/** How many recent behandelingen the profile summary shows (FR-3). */
export const RECENT_BEHANDELINGEN_LIMIT = 5;

/**
 * Pure selection of the "upcoming afspraken" summary: keep only afspraken that
 * start at/after `now` and are not cancelled, sorted soonest-first. Extracted
 * from the mutation so the date/sort logic is unit-testable without a Convex
 * runtime. `now` is injectable for deterministic tests.
 */
export function selectUpcomingAfspraken(
  afspraken: readonly AfspraakSummary[],
  now: number,
): AfspraakSummary[] {
  return afspraken
    .filter((a) => a.startDatetime >= now && a.status !== "geannuleerd")
    .sort((a, b) => a.startDatetime - b.startDatetime);
}

/**
 * Pure selection of the "last five behandelingen" summary: most recent first by
 * `treatmentDate` (ISO `YYYY-MM-DD`, lexically sortable), capped at
 * {@link RECENT_BEHANDELINGEN_LIMIT}. Ties broken by a stable id fallback so the
 * result is deterministic.
 */
export function selectRecentBehandelingen(
  behandelingen: readonly BehandelingSummary[],
): BehandelingSummary[] {
  return [...behandelingen]
    .sort((a, b) => {
      if (a.treatmentDate !== b.treatmentDate) {
        return a.treatmentDate < b.treatmentDate ? 1 : -1;
      }
      return a._id < b._id ? 1 : -1;
    })
    .slice(0, RECENT_BEHANDELINGEN_LIMIT);
}

/** The full profile payload returned to an authorized viewer. */
export interface PatientProfileView {
  patient: {
    _id: GenericId<"patient">;
    _creationTime: number;
    voornaam: string;
    tussenvoegsel?: string;
    achternaam: string;
    geboortedatum: string;
    geslacht: (typeof GESLACHT_VALUES)[number];
    bsn: string;
    email?: string;
    telefoonnummer?: string;
    adres?: { straat: string; huisnummer: string; postcode: string; stad: string };
    notities?: string;
    actief: boolean;
  };
  upcomingAfspraken: AfspraakSummary[];
  recentBehandelingen: BehandelingSummary[];
}

/**
 * The Convex `db` slice the view path needs: a `get` by patient id plus indexed
 * reads of the patient's afspraken/behandelingen. Declared narrowly (no
 * mutating handle beyond what {@link logAudit} brings) so the surface stays
 * read-then-audit only.
 */
interface PatientViewContext extends AuthContext, AuditMutationContext {
  db: AuditMutationContext["db"] & {
    get: (id: GenericId<"patient">) => Promise<PatientProfileView["patient"] | null>;
    query: (table: "afspraak" | "behandeling") => {
      withIndex: (
        index: "by_patient",
        range: (q: { eq: (field: "patientId", value: string) => unknown }) => unknown,
      ) => { collect: () => Promise<Array<Record<string, unknown>>> };
    };
  };
}

/**
 * Read a patient profile and audit the view (Story P-1-S2). See the block
 * comment above for why this is a mutation. The afspraken/behandelingen
 * summaries read the real tables but degrade to empty arrays when those domains
 * have no data yet — a stub/empty state is acceptable in Sprint 1 (#20 Notes),
 * so this never blocks on the Afspraken/Behandelingen epics.
 */
export const getPatientForView = mutationGeneric({
  args: { patientId: v.id("patient") },
  handler: async (ctx, args) => {
    // AC-1: authorize BEFORE any read. Any authenticated staff member may view
    // (FR-3) — identity is sufficient, no role gate. An unauthenticated caller
    // throws here and receives no patient data.
    await requireIdentity(ctx as AuthContext);

    const viewCtx = ctx as unknown as PatientViewContext;

    const patient = await viewCtx.db.get(args.patientId);
    if (patient === null) {
      throw new ConvexError({ code: "patient_not_found" });
    }

    const afspraakRows = await viewCtx.db
      .query("afspraak")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();
    const behandelingRows = await viewCtx.db
      .query("behandeling")
      .withIndex("by_patient", (q) => q.eq("patientId", args.patientId))
      .collect();

    const upcomingAfspraken = selectUpcomingAfspraken(
      afspraakRows as unknown as AfspraakSummary[],
      Date.now(),
    );
    const recentBehandelingen = selectRecentBehandelingen(
      behandelingRows as unknown as BehandelingSummary[],
    );

    // AC-9: PII-free `view` audit entry, in the same transaction as the read.
    await logAudit(viewCtx, {
      action: "view",
      resourceType: "patient",
      resourceId: args.patientId,
    });

    return { patient, upcomingAfspraken, recentBehandelingen } satisfies PatientProfileView;
  },
});
