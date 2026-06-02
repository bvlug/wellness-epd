import type { UserIdentity } from "convex/server";

/**
 * Server-side authorization helpers for Convex functions.
 *
 * Every Convex query / mutation / action that reads or writes patient data
 * (patient, afspraak, behandeling) MUST authorize the caller through these
 * helpers before touching any data. Route protection in the Next.js middleware
 * is a convenience for the browser only — it is NOT a security boundary for the
 * backend. A request can reach a Convex function without a valid Clerk identity
 * (EH-7), and in that case the function must fail closed and expose nothing.
 */

/**
 * The minimal slice of the Convex auth context these helpers depend on.
 *
 * Declaring it locally (rather than importing a full `QueryCtx` /`MutationCtx`)
 * keeps the guard usable from queries, mutations, and actions alike, and makes
 * it unit-testable without spinning up a Convex runtime.
 */
export interface AuthContext {
  auth: {
    getUserIdentity: () => Promise<UserIdentity | null>;
  };
}

/**
 * Error thrown when a Convex function is called without a valid Clerk identity.
 *
 * The message is deliberately generic and contains no caller- or data-specific
 * detail, so an unauthorized call never leaks information (EH-7). Convex
 * surfaces this to the client as an application error, not as data.
 */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Unauthenticated: a valid Clerk identity is required.");
    this.name = "UnauthenticatedError";
  }
}

/**
 * Pure authorization check, decoupled from the Convex runtime for testability.
 *
 * Resolves to the authenticated {@link UserIdentity}, or throws
 * {@link UnauthenticatedError} when there is no valid Clerk identity. Callers
 * should not catch-and-ignore this error: failing closed is the desired
 * behavior for any function that touches patient data.
 */
export async function requireIdentity(ctx: AuthContext): Promise<UserIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new UnauthenticatedError();
  }
  return identity;
}
