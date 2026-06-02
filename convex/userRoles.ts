import { ROLES, type Role } from "./auth";

/**
 * Pure, network-free helpers for manipulating the set of EPD roles carried on a
 * Clerk user's `public_metadata.roles`.
 *
 * These functions are deliberately decoupled from the Clerk SDK and the Convex
 * runtime so they can be unit-tested in isolation (see userRoles.test.ts). The
 * thin network layer that actually reads/writes Clerk lives in `users.ts`; it
 * delegates all role-set reasoning to the functions here.
 *
 * Role semantics:
 *   - A user holds a SET of roles (additive / union semantics, A-2). The set is
 *     stored as a JSON array of strings under `public_metadata.roles`.
 *   - Only values in {@link ROLES} are recognized. Unknown or malformed entries
 *     are dropped on read, so a hand-edited or legacy metadata blob can never
 *     smuggle in an unrecognized role — mirroring `getRoles` in auth.ts.
 *   - The resulting array is always deduplicated and ordered to match the
 *     canonical {@link ROLES} order, giving stable, comparable output.
 */

/** Type guard: is `value` one of the known {@link ROLES}? */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * Normalize an arbitrary set of role-like values into a canonical role array:
 * recognized roles only, deduplicated, ordered by {@link ROLES}. Used so every
 * function here returns output in the same stable shape regardless of input
 * order or duplicates.
 */
function normalize(roles: Iterable<Role>): Role[] {
  const held = new Set<Role>(roles);
  return ROLES.filter((role) => held.has(role));
}

/**
 * Parse the `roles` value read from a Clerk user's `public_metadata` into a
 * clean {@link Role} array. Tolerant by design: a missing value, a non-array, or
 * unknown/malformed entries all collapse to a (possibly empty) array of only the
 * recognized roles. Never throws — callers can feed it raw, untyped metadata.
 */
export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return normalize(value.filter(isRole));
}

/**
 * Return the role set that results from ADDING `role` to `current`. Idempotent:
 * adding a role the user already holds yields an equivalent set. Output is
 * normalized (recognized, deduplicated, canonically ordered).
 */
export function withRole(current: readonly Role[], role: Role): Role[] {
  return normalize([...current, role]);
}

/**
 * Return the role set that results from REMOVING `role` from `current`.
 * Idempotent: removing a role the user does not hold yields an equivalent set.
 * Output is normalized (recognized, deduplicated, canonically ordered).
 */
export function withoutRole(current: readonly Role[], role: Role): Role[] {
  return normalize(current.filter((held) => held !== role));
}
