import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";

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

/**
 * The three roles of the wellness-clinic EPD role-permission matrix (Epic F-2).
 *
 * These are domain terms and stay in Dutch: `balie` (front desk), `behandelaar`
 * (clinician), `admin` (administrator). Declared as a const tuple so the role
 * vocabulary is a single, typed source of truth — function arguments are checked
 * against the {@link Role} union rather than against loose strings.
 */
export const ROLES = ["balie", "behandelaar", "admin"] as const;

/** A role recognized by the authorization layer. */
export type Role = (typeof ROLES)[number];

/**
 * Name of the custom claim, on the Clerk-issued JWT, that carries the caller's
 * roles. The roles are expected as a JSON array of strings, e.g.
 * `{ "roles": ["balie", "behandelaar"] }`.
 *
 * RUNTIME PREREQUISITE (not yet configured): the Clerk "convex" JWT template
 * must be edited in the Clerk dashboard to emit this claim — typically mapped
 * from `user.public_metadata.roles` (or Clerk organization roles). Until that
 * mapping exists, `getUserIdentity()` carries no `roles` claim and every role
 * check fails closed (permission denied), which is the safe default.
 */
export const ROLES_CLAIM = "roles";

/**
 * Error thrown when an authenticated caller lacks the role(s) a Convex function
 * requires. Modeled as a {@link ConvexError} so Convex propagates it to the
 * client as a structured application error (not a 500), while the `data` payload
 * stays free of caller- or patient-identifying detail (AVG/GDPR mindset): it
 * names only the abstract requirement, never who was denied or what they hold.
 */
export class PermissionDeniedError extends ConvexError<{
  code: "permission_denied";
  requiredAnyOf: Role[];
}> {
  constructor(requiredAnyOf: readonly Role[]) {
    super({ code: "permission_denied", requiredAnyOf: [...requiredAnyOf] });
    this.name = "PermissionDeniedError";
  }
}

/**
 * Type guard: is `value` one of the known {@link ROLES}? Used to ignore unknown
 * or malformed claim entries so a tampered/legacy token can never smuggle in an
 * unrecognized role.
 *
 * Exported as the single source of truth for "is this a recognized role?" — the
 * pure role-set helpers in userRoles.ts import this rather than re-declaring it,
 * so the role vocabulary cannot drift between the read (claim) and write
 * (metadata) sides.
 */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Extracts the set of recognized roles the caller holds, read from the
 * {@link ROLES_CLAIM} claim on the Clerk identity. Tolerant by design: a missing
 * claim, a non-array value, or unknown entries all collapse to "no recognized
 * roles" rather than throwing — the authorization decision (and its fail-closed
 * behavior) lives in {@link assertHasRole}, keeping extraction side-effect free.
 *
 * Custom Clerk JWT claims surface as extra properties on {@link UserIdentity};
 * Convex types them loosely, so we read through an index access and validate.
 */
export function getRoles(identity: UserIdentity): Role[] {
  const claim = (identity as unknown as Record<string, unknown>)[ROLES_CLAIM];
  if (!Array.isArray(claim)) {
    return [];
  }
  return claim.filter(isRole);
}

/**
 * Authorize the caller against a role requirement, using additive/union
 * semantics (A-2): the caller passes if they hold ANY of the `allowed` roles.
 *
 * Order of checks matters and is deliberate:
 *   1. {@link requireIdentity} runs first, so an unauthenticated caller is
 *      rejected with an auth error before any role logic — and, in real
 *      functions, before any data access (AC-1, EH-7).
 *   2. Only then are roles evaluated; a caller lacking every required role gets
 *      a {@link PermissionDeniedError} ({@link ConvexError}) thrown before the
 *      calling function reads or writes any patient data (AC-2).
 *
 * Returns the authenticated {@link UserIdentity} on success so callers can reuse
 * it (e.g. for the subject id) without a second `getUserIdentity()` round-trip.
 *
 * @example
 *   // Inside a Convex mutation that creates a behandeling:
 *   await assertHasRole(ctx, ["behandelaar", "admin"]);
 */
export async function assertHasRole(
  ctx: AuthContext,
  allowed: readonly Role[],
): Promise<UserIdentity> {
  const identity = await requireIdentity(ctx);
  const held = getRoles(identity);
  const permitted = held.some((role) => allowed.includes(role));
  if (!permitted) {
    throw new PermissionDeniedError(allowed);
  }
  return identity;
}
