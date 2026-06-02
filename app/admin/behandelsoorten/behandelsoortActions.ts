import type { BehandelsoortAdminRow } from "@/convex/behandelsoort";
import { makeFunctionReference } from "convex/server";
import type { GenericId } from "convex/values";

/**
 * Typed references to the behandelsoort admin Convex functions
 * (convex/behandelsoort.ts), for the management screen (Story B-3-S2).
 *
 * The project has no generated `convex/_generated/api` yet (that file appears
 * only after `npx convex dev` runs codegen), so the frontend bridges to the
 * query/mutations with `makeFunctionReference`, naming each by its
 * `"file:export"` path — the same pattern used by app/admin/users/roleActions.ts
 * and components/NewPatientForm.tsx. The explicit type arguments restore
 * end-to-end typing at the `useQuery` / `useMutation` call sites, matching the
 * shapes declared in convex/behandelsoort.ts. Once codegen exists these can be
 * swapped for `api.behandelsoort.*` with no change to the call sites' types.
 */

/** The id type the mutations accept (a Convex document id for the table). */
export type BehandelsoortId = GenericId<"behandelsoort">;

/** Admin-only list of all behandelsoorten (active + inactive) for the screen. */
export const listAllForAdminRef = makeFunctionReference<
  "query",
  Record<string, never>,
  BehandelsoortAdminRow[]
>("behandelsoort:listAllForAdmin");

export const createBehandelsoortRef = makeFunctionReference<
  "mutation",
  { naam: string },
  { behandelsoortId: BehandelsoortId }
>("behandelsoort:createBehandelsoort");

export const renameBehandelsoortRef = makeFunctionReference<
  "mutation",
  { id: BehandelsoortId; naam: string },
  { behandelsoortId: BehandelsoortId }
>("behandelsoort:renameBehandelsoort");

export const deactivateBehandelsoortRef = makeFunctionReference<
  "mutation",
  { id: BehandelsoortId },
  { behandelsoortId: BehandelsoortId }
>("behandelsoort:deactivateBehandelsoort");

export const deleteBehandelsoortRef = makeFunctionReference<
  "mutation",
  { id: BehandelsoortId },
  { behandelsoortId: BehandelsoortId }
>("behandelsoort:deleteBehandelsoort");
