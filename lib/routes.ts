/**
 * Route policy for the Clerk middleware — the single source of truth for which
 * paths are reachable without an authenticated Clerk session.
 *
 * Only the Clerk auth UI is public: the sign-in and sign-up pages themselves and
 * their catch-all sub-routes (SSO callbacks, factor steps, email verification).
 * Everything else is a protected EPD page.
 *
 * The patterns are interpreted by Clerk's `createRouteMatcher` (path-to-regexp).
 * They are intentionally written as an exact base (`/sign-in`) plus a nested
 * wildcard (`/sign-in/(.*)`) rather than `/sign-in(.*)`: the latter is an
 * unanchored suffix match that would also make e.g. `/sign-in-history` public.
 *
 * `middleware.ts` builds the live matcher from these patterns; `routes.test.ts`
 * exercises that same matcher, so the test reflects the real gate (no parallel
 * re-implementation that could drift).
 */
export const PUBLIC_ROUTE_PATTERNS = [
  "/sign-in",
  "/sign-in/(.*)",
  "/sign-up",
  "/sign-up/(.*)",
] as const;

/**
 * Patiëntbeheer route helpers — a single source of truth for the patient pages
 * so navigation and redirects never hardcode path strings. All of these are
 * protected (not in {@link PUBLIC_ROUTE_PATTERNS}), so the Clerk middleware
 * gates them.
 */
export const PATIENT_ROUTES = {
  /** The "New patient" form (Story P-1-S1). */
  new: "/patienten/nieuw",
  /**
   * A patient's profile page (Story P-1-S2 / #20). Built here only as a minimal
   * placeholder that the create flow can redirect to on success; #20 fleshes it
   * out into the real profile view.
   */
  profile: (patientId: string): string => `/patienten/${patientId}`,
} as const;
