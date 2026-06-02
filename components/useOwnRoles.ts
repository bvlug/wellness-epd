"use client";

import { useUser } from "@clerk/nextjs";

/**
 * Reads the signed-in user's own roles from their Clerk public metadata
 * (`publicMetadata.roles`). Client-side and UX-only: it decides which
 * navigation affordances to show. It is NOT a security boundary — every Convex
 * function authorizes the role server-side regardless of what the UI renders,
 * and the admin screens guard themselves too.
 *
 * `ready` is false until Clerk has loaded, so callers can avoid flashing the
 * wrong affordances before the role is known.
 *
 * (The existing admin screens carry an inline copy of this logic; this shared
 * hook is the single source for new UI and a target to converge them on.)
 */
export function useOwnRoles(): { ready: boolean; roles: string[] } {
  const { isLoaded, user } = useUser();
  if (!isLoaded) {
    return { ready: false, roles: [] };
  }
  const raw = user?.publicMetadata?.roles;
  const roles = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
  return { ready: true, roles };
}
