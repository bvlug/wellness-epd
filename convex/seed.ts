import { internalMutationGeneric } from "convex/server";

/**
 * Convex dev seed data (Story B-3-S1).
 *
 * Seeds a small set of default `behandelsoort` (treatment-type) entries so that
 * the afspraak form (A-1-S1) and behandeling form (B-1-S1) have a populated
 * dropdown to work against before the admin management UI (B-3-S2) exists.
 *
 * These names are generic wellness-clinic treatment types — controlled
 * vocabulary, NOT patient-identifying data — so they are safe to ship as
 * fixtures (BR-10). The seed is data only; it never touches patient records.
 *
 * Run against a local/dev deployment with:
 *   npx convex run seed:seedBehandelsoorten
 */

/** Default treatment types seeded into an empty `behandelsoort` collection. */
export const DEFAULT_BEHANDELSOORTEN = [
  "Klassieke massage",
  "Sportmassage",
  "Ontspanningsmassage",
  "Hot stone massage",
  "Voetreflexologie",
] as const;

/**
 * Pure helper: of the {@link DEFAULT_BEHANDELSOORTEN}, which are not yet present
 * given the names that already exist? Extracted from the mutation so the
 * idempotency rule (seed only what is missing) is unit-testable without a Convex
 * runtime, mirroring the pure-helper pattern in `convex/auth.ts`.
 */
export function missingBehandelsoorten(existingNamen: readonly string[]): string[] {
  const present = new Set(existingNamen);
  return DEFAULT_BEHANDELSOORTEN.filter((naam) => !present.has(naam));
}

/**
 * Idempotent seed of the default behandelsoort vocabulary. Re-running it only
 * inserts entries whose `naam` is not already present, so it is safe to run
 * repeatedly against a dev deployment. Marked `internal` so it is never exposed
 * as a public, client-callable function.
 *
 * Implementation note: uses the runtime-agnostic `internalMutationGeneric`
 * builder (as `convex/me.ts` does for queries) so the project typechecks before
 * `npx convex dev` has generated the typed `internalMutation` builder.
 */
export const seedBehandelsoorten = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query("behandelsoort").collect();
    const toCreate = missingBehandelsoorten(existing.map((row) => String(row.naam)));
    for (const naam of toCreate) {
      await ctx.db.insert("behandelsoort", { naam, actief: true });
    }
    return {
      created: toCreate.length,
      skipped: DEFAULT_BEHANDELSOORTEN.length - toCreate.length,
    };
  },
});
