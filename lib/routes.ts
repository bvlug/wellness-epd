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
   * A patient's profile page (Story P-1-S2 / #20). The create flow redirects
   * here on success and #20 fleshes it out into the real read-only profile view.
   */
  profile: (patientId: string): string => `/patienten/${patientId}`,
  /**
   * The edit form for an existing patient (Story P-1-S3 / #22). The profile page
   * links here; on a successful save the edit flow redirects back to
   * {@link PATIENT_ROUTES.profile}.
   */
  edit: (patientId: string): string => `/patienten/${patientId}/bewerken`,
  /**
   * A patient's full behandeling history (Story P-1-S2 "view full history"
   * link). The dedicated history page belongs to a later Behandelingen story;
   * this helper fixes the URL shape now so the profile link is stable and the
   * eventual route can slot in without touching callers.
   */
  history: (patientId: string): string => `/patienten/${patientId}/behandelingen`,
} as const;
