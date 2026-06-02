import { queryGeneric } from "convex/server";
import { ConvexError, type GenericId } from "convex/values";
import { ROLES, assertHasRole } from "./auth";

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
