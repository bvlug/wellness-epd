"use node";

import { type ClerkClient, type User, createClerkClient } from "@clerk/backend";
import { actionGeneric } from "convex/server";
import { ConvexError, v } from "convex/values";
import { type AuthContext, ROLES, type Role, assertHasRole } from "./auth";
import { parseRoles, withRole, withoutRole } from "./userRoles";

/**
 * Admin-only Convex actions backing the user/role management screen (Story
 * F-3-S2). These are the WRITE side of the role model: the authorization layer
 * (convex/auth.ts) READS roles from the Clerk JWT `roles` claim, which Clerk
 * maps from each user's `public_metadata.roles`; this file is what an admin uses
 * to edit that `public_metadata.roles` without opening the Clerk dashboard.
 *
 * Why actions (not mutations): they call the Clerk Management API over the
 * network, which is only permitted from Convex's Node runtime — hence the
 * `"use node"` directive and `actionGeneric`. (Like the rest of the codebase,
 * this uses the runtime-agnostic builder so the project typechecks before
 * `npx convex dev` has generated the typed `action` builder; the authorization
 * logic is identical either way.)
 *
 * SECURITY: every action below opens with `assertHasRole(ctx, ["admin"])`.
 * That server-side check — verifying the caller's Clerk identity and roles — is
 * the real boundary. The client-side admin check on the page is only a UX
 * affordance (AC-4) and is NOT trusted here.
 *
 * RUNTIME PREREQUISITE: the Clerk secret key must be set as a Convex env secret,
 * NOT shipped to the browser:
 *   npx convex env set CLERK_SECRET_KEY sk_...
 * It is never logged or returned to the client.
 *
 * AVG/GDPR note: the users listed here are clinic STAFF (not patients), so
 * surfacing their name and email to an admin is acceptable and is not a
 * patient-data disclosure. Secrets and tokens are never logged.
 */

/** Clerk caps a single user-list page at 500; we page through in this size. */
const CLERK_PAGE_SIZE = 100;

/** Public, non-sensitive view of a staff user returned to the admin screen. */
export interface StaffUser {
  id: string;
  name: string | null;
  email: string | null;
  roles: Role[];
}

/**
 * Error raised when CLERK_SECRET_KEY is not configured on the Convex
 * deployment. Modeled as a ConvexError so the screen can show a clear message
 * instead of an opaque 500 — the payload names only the missing config, never a
 * secret value.
 */
class ClerkNotConfiguredError extends ConvexError<{ code: "clerk_not_configured" }> {
  constructor() {
    super({ code: "clerk_not_configured" });
    this.name = "ClerkNotConfiguredError";
  }
}

/**
 * A factory that lazily produces a Clerk backend client. The actions below take
 * one of these rather than reading `process.env` inline, which gives two things:
 *   1. Production reads the secret from the Convex env at call time (see
 *      {@link clerk}), never at import time, so a missing secret fails closed
 *      with a structured error.
 *   2. Tests can inject a factory returning a MOCK client — and, crucially, can
 *      assert the factory is only ever invoked AFTER authorization passes, so an
 *      unauthorized caller never reaches the Clerk network layer (AC-4).
 */
export type ClerkClientFactory = () => ClerkClient;

/**
 * Build a Clerk backend client from the Convex env secret. Fails closed with a
 * structured error if the secret is missing rather than letting the SDK throw an
 * unstructured one. This is the production factory; it is the only place the
 * secret is read, and the value is never logged or returned to the client.
 */
function clerk(): ClerkClient {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    throw new ClerkNotConfiguredError();
  }
  return createClerkClient({ secretKey });
}

/** Map a Clerk `User` to the minimal, non-sensitive shape the screen needs. */
function toStaffUser(user: User): StaffUser {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  return {
    id: user.id,
    name: name.length > 0 ? name : null,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    roles: parseRoles(user.publicMetadata?.roles),
  };
}

/**
 * Validator for a role argument. Re-derives the literal union from {@link ROLES}
 * so the single source of truth for the role vocabulary stays auth.ts — adding a
 * role there automatically widens what these actions accept.
 */
const roleValidator = v.union(...ROLES.map((role) => v.literal(role)));

/**
 * Core logic of {@link listUsers}, decoupled from the Convex `action` wrapper and
 * from the production secret so it is unit-testable with a mocked Clerk client.
 *
 * SECURITY ORDERING (AC-4): `assertHasRole` runs FIRST and `getClerk` is only
 * invoked once authorization has passed. An unauthenticated or non-admin caller
 * therefore never causes a Clerk client to be built or a Clerk API call to be
 * made — the tests assert exactly this by passing a factory that records whether
 * it was called.
 *
 * Pages through the entire Clerk user directory so the screen shows everyone,
 * not just the first page. Returns only id / display name / primary email /
 * roles — no Clerk tokens, password hashes, or other sensitive fields.
 */
export async function listUsersHandler(
  ctx: AuthContext,
  getClerk: ClerkClientFactory,
): Promise<StaffUser[]> {
  await assertHasRole(ctx, ["admin"]);
  const client = getClerk();

  const users: StaffUser[] = [];
  for (let offset = 0; ; offset += CLERK_PAGE_SIZE) {
    const page = await client.users.getUserList({
      limit: CLERK_PAGE_SIZE,
      offset,
      orderBy: "+created_at",
    });
    for (const user of page.data) {
      users.push(toStaffUser(user));
    }
    // `totalCount` is the full directory size; stop once we've collected it.
    if (users.length >= page.totalCount || page.data.length === 0) {
      break;
    }
  }
  return users;
}

/**
 * Core logic of {@link assignRole}/{@link removeRole}: the shared read-modify-write
 * against a single Clerk user's `public_metadata.roles`, parameterized by the
 * pure role-set transform to apply. Decoupled from the `action` wrapper and the
 * production secret so it is unit-testable with a mocked Clerk client.
 *
 * SECURITY ORDERING (AC-4): `assertHasRole` runs FIRST; `getClerk` is only
 * invoked after authorization passes, so an unauthorized caller never reaches
 * the Clerk network layer.
 *
 * Writes back only the `roles` key via `updateUserMetadata`, which performs a
 * shallow merge of top-level `publicMetadata` keys on Clerk's side — so any
 * OTHER public metadata the user carries (e.g. an unrelated `somethingElse`
 * key) is preserved untouched. We deliberately send just `{ roles: next }`
 * rather than re-sending the whole blob, relying on that documented merge.
 */
async function updateUserRoleHandler(
  ctx: AuthContext,
  getClerk: ClerkClientFactory,
  userId: string,
  transform: (current: Role[]) => Role[],
): Promise<StaffUser> {
  await assertHasRole(ctx, ["admin"]);
  const client = getClerk();

  const user = await client.users.getUser(userId);
  const current = parseRoles(user.publicMetadata?.roles);
  const next = transform(current);
  const updated = await client.users.updateUserMetadata(userId, {
    publicMetadata: { roles: next },
  });
  return toStaffUser(updated);
}

/**
 * Core logic of {@link assignRole}. Idempotent: assigning a role the user already
 * holds is a no-op write. See {@link updateUserRoleHandler} for the merge/ordering
 * contract.
 */
export function assignRoleHandler(
  ctx: AuthContext,
  getClerk: ClerkClientFactory,
  userId: string,
  role: Role,
): Promise<StaffUser> {
  return updateUserRoleHandler(ctx, getClerk, userId, (current) => withRole(current, role));
}

/**
 * Core logic of {@link removeRole}. Idempotent: removing a role the user does not
 * hold is a no-op write. See {@link updateUserRoleHandler} for the merge/ordering
 * contract.
 */
export function removeRoleHandler(
  ctx: AuthContext,
  getClerk: ClerkClientFactory,
  userId: string,
  role: Role,
): Promise<StaffUser> {
  return updateUserRoleHandler(ctx, getClerk, userId, (current) => withoutRole(current, role));
}

/**
 * List all Clerk users with their current EPD role(s). Admin only. Thin Convex
 * `action` wrapper over {@link listUsersHandler}, supplying the production Clerk
 * factory ({@link clerk}).
 */
export const listUsers = actionGeneric({
  args: {},
  handler: (ctx): Promise<StaffUser[]> => listUsersHandler(ctx, clerk),
});

/**
 * Assign `role` to the user identified by `userId`. Admin only. Thin Convex
 * `action` wrapper over {@link assignRoleHandler}.
 *
 * The change takes effect on the user's NEXT Convex call: roles are read from
 * the Clerk JWT, which is reissued with the new `public_metadata.roles` on the
 * user's next token refresh (AC-2).
 */
export const assignRole = actionGeneric({
  args: { userId: v.string(), role: roleValidator },
  handler: (ctx, { userId, role }): Promise<StaffUser> =>
    assignRoleHandler(ctx, clerk, userId, role),
});

/**
 * Remove `role` from the user identified by `userId`. Admin only. Thin Convex
 * `action` wrapper over {@link removeRoleHandler}.
 */
export const removeRole = actionGeneric({
  args: { userId: v.string(), role: roleValidator },
  handler: (ctx, { userId, role }): Promise<StaffUser> =>
    removeRoleHandler(ctx, clerk, userId, role),
});
