import { queryGeneric } from "convex/server";
import { requireIdentity } from "./auth";

/**
 * Returns a minimal, non-sensitive view of the currently authenticated user.
 *
 * This is the reference implementation of the authorized-function pattern that
 * every patient-data function must follow: call {@link requireIdentity} first,
 * which throws an auth error (EH-7) when there is no valid Clerk identity, so
 * an unauthenticated caller receives an error and never any data. Here it also
 * confirms that a signed-in browser's Convex queries carry a valid Clerk JWT
 * (AC-1): the identity is only populated when the JWT verifies against the
 * `convex` template configured in convex/auth.config.ts.
 *
 * Implementation note: this uses the runtime-agnostic `queryGeneric` builder so
 * the project typechecks before `npx convex dev` has generated the typed
 * `query` builder under `convex/_generated/`. Once codegen has run, this can be
 * switched to `import { query } from "./_generated/server"` for full
 * data-model typing — the authorization logic stays identical.
 *
 * No patient-identifying data is returned here; only the caller's own subject
 * id and (optional) name are surfaced, which the user already possesses.
 */
export const current = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return {
      subject: identity.subject,
      name: identity.name ?? null,
    };
  },
});
