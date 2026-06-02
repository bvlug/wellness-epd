import { mutationGeneric, queryGeneric } from "convex/server";
import { ConvexError, type GenericId, v } from "convex/values";
import { type AuditMutationContext, logAudit } from "./audit";
import { type AuthContext, ROLES, type Role, assertHasRole } from "./auth";

/**
 * Behandelsoort (treatment-type) controlled vocabulary — read + validation
 * (Story B-3-S1). The shared `behandelsoort` collection backs the dropdown on
 * both the afspraak form (A-1-S1) and the behandeling form (B-1-S1); admin CRUD
 * over it arrives later in B-3-S2. This module exposes the active entries to the
 * UI and gives downstream create-mutations the BR-12 referential check.
 *
 * Following the pattern in `convex/me.ts`, the public function uses the
 * runtime-agnostic `queryGeneric` builder so the project typechecks before
 * `npx convex dev` codegen, while the data-shaping and validation logic live in
 * pure, unit-testable helpers (as in `convex/auth.ts`).
 */

/** The `behandelsoort` document shape this module relies on (schema F-3-S1). */
export interface BehandelsoortDoc {
  _id: GenericId<"behandelsoort">;
  naam: string;
  actief: boolean;
}

/** A single dropdown option — only the id and label the UI needs. */
export interface BehandelsoortOption {
  _id: GenericId<"behandelsoort">;
  naam: string;
}

/**
 * Pure projection for the dropdown: keep only active entries (deactivated
 * vocabulary must not be offered for new afspraken/behandelingen — AC), reduce
 * each to `{ _id, naam }`, and sort by name using Dutch collation so the list
 * reads naturally for staff. Extracted from the query so the active-only +
 * ordering rules are testable without a Convex runtime.
 */
export function toActiveOptions(rows: readonly BehandelsoortDoc[]): BehandelsoortOption[] {
  return rows
    .filter((row) => row.actief)
    .map((row) => ({ _id: row._id, naam: row.naam }))
    .sort((a, b) => a.naam.localeCompare(b.naam, "nl"));
}

/**
 * Error thrown when a supplied `behandelsoortId` does not reference an active
 * behandelsoort (BR-12). A {@link ConvexError} so Convex surfaces it to the
 * client as a structured validation error rather than a 500. The payload names
 * only the abstract rule — no patient- or caller-identifying data.
 */
export class InactiveBehandelsoortError extends ConvexError<{
  code: "inactive_behandelsoort";
}> {
  constructor() {
    super({ code: "inactive_behandelsoort" });
    this.name = "InactiveBehandelsoortError";
  }
}

/** Minimal reader surface {@link assertActiveBehandelsoort} needs (testable). */
export interface BehandelsoortReader {
  get: (id: GenericId<"behandelsoort">) => Promise<BehandelsoortDoc | null>;
}

/**
 * BR-12 referential guard for the afspraak (A-1-S1) and behandeling (B-1-S1)
 * create/edit mutations: a supplied `behandelsoortId` must resolve to an
 * existing, active behandelsoort. Throws {@link InactiveBehandelsoortError} for
 * a missing record or one with `actief = false`; otherwise returns the document
 * so the caller can reuse it without a second `db.get`.
 *
 * @example
 *   // Inside the afspraak-create mutation, once a behandelsoort is supplied:
 *   if (args.behandelsoortId !== undefined) {
 *     await assertActiveBehandelsoort(ctx.db, args.behandelsoortId);
 *   }
 */
export async function assertActiveBehandelsoort(
  db: BehandelsoortReader,
  behandelsoortId: GenericId<"behandelsoort">,
): Promise<BehandelsoortDoc> {
  const behandelsoort = await db.get(behandelsoortId);
  if (behandelsoort === null || !behandelsoort.actief) {
    throw new InactiveBehandelsoortError();
  }
  return behandelsoort;
}

/**
 * Public query backing the behandelsoort dropdown. Returns active entries only,
 * sorted by name. Authorization: any recognized clinic role (balie schedules
 * afspraken, behandelaar records behandelingen, admin manages) — fail closed for
 * unauthenticated or role-less callers, consistent with the rest of the backend.
 *
 * Behandelsoort is reference vocabulary, not patient data, so no audit entry is
 * written for reading it (AC-9 covers patient/behandeling access only).
 *
 * Runtime prerequisite: until the Clerk "convex" JWT template emits the `roles`
 * claim (see ROLES_CLAIM in convex/auth.ts), the role check denies every caller
 * by design — that gap belongs to the auth foundation (F-2), not this story.
 */
export const listActive = queryGeneric({
  args: {},
  handler: async (ctx) => {
    await assertHasRole(ctx, ROLES);
    // `queryGeneric` types documents loosely (no codegen dependency); the schema
    // (F-3-S1) guarantees the `behandelsoort` shape, so narrow to BehandelsoortDoc.
    const rows = (await ctx.db.query("behandelsoort").collect()) as unknown as BehandelsoortDoc[];
    return toActiveOptions(rows);
  },
});

/* -------------------------------------------------------------------------- *
 * Admin management — create / rename / deactivate / delete (Story B-3-S2)
 *
 * The admin curates this controlled vocabulary so only relevant treatment
 * types are offered to balie/behandelaar (FR-19). Two invariants drive the
 * design:
 *
 *  - **Admin-only (A-28).** Every mutation below opens with
 *    `assertHasRole(ctx, ["admin"])` BEFORE any read or write. The management
 *    screen's admin gate is a UX convenience only; this server check is the
 *    real boundary — a balie/behandelaar calling these mutations directly is
 *    denied and nothing is read or written.
 *  - **Soft-delete is the normal removal path (A-27).** Deactivation
 *    (`actief = false`) is how vocabulary is retired: a deactivated entry drops
 *    out of {@link listActive} but its name still resolves for afspraken /
 *    behandelingen that reference it by id (a rename is therefore reflected
 *    automatically on the read path). A hard-delete is only permitted when the
 *    entry is referenced by NO afspraak and NO behandeling; otherwise it throws
 *    a {@link BehandelsoortReferencedError} and the row remains.
 *
 * Each admin write logs a PII-free audit entry (create→create, rename→edit,
 * deactivate→deactivate) via {@link logAudit}; behandelsoort names are
 * controlled vocabulary, never patient data.
 * -------------------------------------------------------------------------- */

/** Roles permitted to manage the behandelsoort vocabulary (FR-19, A-28). */
const MANAGE_ROLES: readonly Role[] = ["admin"];

/**
 * A management-screen row: the full entry including its `actief` flag, so the
 * admin can see and act on deactivated entries too (unlike {@link listActive},
 * which is the active-only dropdown projection for balie/behandelaar).
 */
export interface BehandelsoortAdminRow {
  _id: GenericId<"behandelsoort">;
  naam: string;
  actief: boolean;
}

/**
 * Pure projection for the admin management screen: keep every entry (active AND
 * inactive) and sort by name with Dutch collation, with active entries listed
 * before inactive ones so the working vocabulary reads first. Extracted from the
 * query so the ordering rule is unit-testable without a Convex runtime.
 */
export function toAdminRows(rows: readonly BehandelsoortDoc[]): BehandelsoortAdminRow[] {
  return rows
    .map((row) => ({ _id: row._id, naam: row.naam, actief: row.actief }))
    .sort((a, b) => {
      if (a.actief !== b.actief) {
        return a.actief ? -1 : 1;
      }
      return a.naam.localeCompare(b.naam, "nl");
    });
}

/**
 * Admin-only query backing the management screen. Returns ALL behandelsoorten
 * (active and inactive) so the admin can manage the full vocabulary. Authorizes
 * `["admin"]` server-side (A-28) BEFORE any read, so a balie/behandelaar calling
 * it directly receives a permission-denied error and no data — independent of
 * the screen's own client-side admin gate.
 */
export const listAllForAdmin = queryGeneric({
  args: {},
  handler: async (ctx) => {
    await assertHasRole(ctx as AuthContext, MANAGE_ROLES);
    const rows = (await ctx.db.query("behandelsoort").collect()) as unknown as BehandelsoortDoc[];
    return toAdminRows(rows);
  },
});

/** Maximum stored name length — a sane cap for a short vocabulary label. */
export const BEHANDELSOORT_NAAM_MAX_LENGTH = 100;

/**
 * Structured, PII-free validation error for a bad behandelsoort name. A
 * {@link ConvexError} so Convex surfaces it to the client as data (the screen
 * branches on `code`) rather than a 500. The payload names only the abstract
 * rule — never the rejected value (it is vocabulary, not PII, but we keep the
 * error shape uniform with the rest of the backend).
 */
export class BehandelsoortNaamError extends ConvexError<{
  code: "invalid_naam";
  reason: "empty" | "too_long";
}> {
  constructor(reason: "empty" | "too_long") {
    super({ code: "invalid_naam", reason });
    this.name = "BehandelsoortNaamError";
  }
}

/**
 * Error thrown when an admin tries to hard-delete a behandelsoort that is still
 * referenced by at least one afspraak or behandeling (A-27). The row is NOT
 * deleted. The payload names the rule only — no afspraak/behandeling/patient
 * ids — so it can be surfaced to the client without leaking references.
 */
export class BehandelsoortReferencedError extends ConvexError<{
  code: "behandelsoort_referenced";
}> {
  constructor() {
    super({ code: "behandelsoort_referenced" });
    this.name = "BehandelsoortReferencedError";
  }
}

/**
 * Error thrown when a mutation targets a behandelsoort id that does not exist
 * (e.g. it was already hard-deleted). Structured + PII-free for the same
 * reasons as the others.
 */
export class BehandelsoortNotFoundError extends ConvexError<{
  code: "behandelsoort_not_found";
}> {
  constructor() {
    super({ code: "behandelsoort_not_found" });
    this.name = "BehandelsoortNotFoundError";
  }
}

/**
 * Normalize and validate a behandelsoort name. Pure and unit-testable: trims
 * surrounding whitespace, rejects an empty result ({@link BehandelsoortNaamError}
 * `empty`) and one over {@link BEHANDELSOORT_NAAM_MAX_LENGTH} characters
 * (`too_long`), and returns the canonical value to store. Shared by the create
 * and rename paths so both enforce the same rule.
 */
export function normalizeBehandelsoortNaam(naam: string): string {
  const trimmed = naam.trim();
  if (trimmed.length === 0) {
    throw new BehandelsoortNaamError("empty");
  }
  if (trimmed.length > BEHANDELSOORT_NAAM_MAX_LENGTH) {
    throw new BehandelsoortNaamError("too_long");
  }
  return trimmed;
}

/**
 * Pure A-27 decision: given how many afspraken and behandelingen reference an
 * entry, may it be hard-deleted? Throws {@link BehandelsoortReferencedError}
 * when either count is non-zero; otherwise returns (deletion may proceed).
 * Extracted so the referential rule is testable without a Convex runtime.
 */
export function assertDeletable(referenceCounts: {
  afspraken: number;
  behandelingen: number;
}): void {
  if (referenceCounts.afspraken > 0 || referenceCounts.behandelingen > 0) {
    throw new BehandelsoortReferencedError();
  }
}

/**
 * The Convex `db` slice the admin mutations need, declared narrowly (mirroring
 * `convex/patients.ts`) so the logic stays close to the real handle while the
 * pure helpers above carry the rules. `query(...).withIndex(...)` is the
 * `by_behandelsoort` reference lookup used by the A-27 check.
 */
interface BehandelsoortMutationContext extends AuthContext, AuditMutationContext {
  db: AuditMutationContext["db"] & {
    insert: (
      table: "behandelsoort",
      document: { naam: string; actief: boolean },
    ) => Promise<GenericId<"behandelsoort">>;
    get: (id: GenericId<"behandelsoort">) => Promise<BehandelsoortDoc | null>;
    patch: (
      id: GenericId<"behandelsoort">,
      fields: Partial<{ naam: string; actief: boolean }>,
    ) => Promise<void>;
    delete: (id: GenericId<"behandelsoort">) => Promise<void>;
    query: (table: "afspraak" | "behandeling") => {
      withIndex: (
        index: "by_behandelsoort",
        range: (q: {
          eq: (field: "behandelsoortId", value: GenericId<"behandelsoort">) => unknown;
        }) => unknown,
      ) => { first: () => Promise<unknown | null> };
    };
  };
}

/** Validator for a behandelsoort id argument (re-validated logic lives above). */
const behandelsoortIdValidator = v.id("behandelsoort");

/**
 * Load the behandelsoort or throw {@link BehandelsoortNotFoundError}. Shared by
 * the rename/deactivate/delete mutations so a stale id fails uniformly.
 */
async function requireBehandelsoort(
  db: BehandelsoortMutationContext["db"],
  id: GenericId<"behandelsoort">,
): Promise<BehandelsoortDoc> {
  const doc = await db.get(id);
  if (doc === null) {
    throw new BehandelsoortNotFoundError();
  }
  return doc;
}

/**
 * Create a new ACTIVE behandelsoort (FR-19). Admin only (A-28). The name is
 * normalized/validated, the entry is inserted with `actief = true` so it
 * appears immediately in {@link listActive} for balie/behandelaar, and a
 * PII-free `create` audit entry is written.
 */
export const createBehandelsoort = mutationGeneric({
  args: { naam: v.string() },
  handler: async (ctx, args) => {
    await assertHasRole(ctx as AuthContext, MANAGE_ROLES);
    const naam = normalizeBehandelsoortNaam(args.naam);

    const mutationCtx = ctx as unknown as BehandelsoortMutationContext;
    const behandelsoortId = await mutationCtx.db.insert("behandelsoort", { naam, actief: true });

    await logAudit(mutationCtx, {
      action: "create",
      resourceType: "behandelsoort",
      resourceId: behandelsoortId,
    });

    return { behandelsoortId };
  },
});

/**
 * Rename a behandelsoort (FR-19). Admin only (A-28). Because afspraken and
 * behandelingen reference the entry by id — never by a stored copy of the name —
 * a rename here is reflected automatically wherever the name is resolved from
 * the behandelsoort record (the read path resolves through the id). Logs an
 * `edit` audit entry.
 */
export const renameBehandelsoort = mutationGeneric({
  args: { id: behandelsoortIdValidator, naam: v.string() },
  handler: async (ctx, args) => {
    await assertHasRole(ctx as AuthContext, MANAGE_ROLES);
    const naam = normalizeBehandelsoortNaam(args.naam);

    const mutationCtx = ctx as unknown as BehandelsoortMutationContext;
    await requireBehandelsoort(mutationCtx.db, args.id);
    await mutationCtx.db.patch(args.id, { naam });

    await logAudit(mutationCtx, {
      action: "edit",
      resourceType: "behandelsoort",
      resourceId: args.id,
    });

    return { behandelsoortId: args.id };
  },
});

/**
 * Deactivate a behandelsoort (soft-delete; A-27 normal removal path). Admin only
 * (A-28). Sets `actief = false` so the entry drops out of {@link listActive} and
 * is no longer offered for new afspraken/behandelingen, while existing
 * references still resolve its name. Idempotent: deactivating an already
 * inactive entry is a no-op patch. Logs a `deactivate` audit entry.
 */
export const deactivateBehandelsoort = mutationGeneric({
  args: { id: behandelsoortIdValidator },
  handler: async (ctx, args) => {
    await assertHasRole(ctx as AuthContext, MANAGE_ROLES);

    const mutationCtx = ctx as unknown as BehandelsoortMutationContext;
    await requireBehandelsoort(mutationCtx.db, args.id);
    await mutationCtx.db.patch(args.id, { actief: false });

    await logAudit(mutationCtx, {
      action: "deactivate",
      resourceType: "behandelsoort",
      resourceId: args.id,
    });

    return { behandelsoortId: args.id };
  },
});

/**
 * Hard-delete a behandelsoort — permitted ONLY when nothing references it
 * (A-27). Admin only (A-28). Looks up whether any afspraak or behandeling points
 * at the entry through the `by_behandelsoort` indexes; if either does, throws
 * {@link BehandelsoortReferencedError} and leaves the row intact (deactivation
 * is the intended path for in-use vocabulary). On a true zero-reference delete,
 * a `deactivate` audit entry is logged (the closest existing audit action for a
 * removal; the audit vocabulary has no separate `delete`).
 *
 * Note: no audit entry is written when the delete is refused — nothing changed.
 */
export const deleteBehandelsoort = mutationGeneric({
  args: { id: behandelsoortIdValidator },
  handler: async (ctx, args) => {
    await assertHasRole(ctx as AuthContext, MANAGE_ROLES);

    const mutationCtx = ctx as unknown as BehandelsoortMutationContext;
    await requireBehandelsoort(mutationCtx.db, args.id);

    const referencingAfspraak = await mutationCtx.db
      .query("afspraak")
      .withIndex("by_behandelsoort", (q) => q.eq("behandelsoortId", args.id))
      .first();
    const referencingBehandeling = await mutationCtx.db
      .query("behandeling")
      .withIndex("by_behandelsoort", (q) => q.eq("behandelsoortId", args.id))
      .first();

    assertDeletable({
      afspraken: referencingAfspraak === null ? 0 : 1,
      behandelingen: referencingBehandeling === null ? 0 : 1,
    });

    await mutationCtx.db.delete(args.id);

    await logAudit(mutationCtx, {
      action: "deactivate",
      resourceType: "behandelsoort",
      resourceId: args.id,
    });

    return { behandelsoortId: args.id };
  },
});
