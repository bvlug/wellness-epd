/**
 * Route policy shared between the Clerk middleware and its tests.
 *
 * `PUBLIC_ROUTE_PATTERNS` are the only paths reachable without an authenticated
 * Clerk session — the sign-in and sign-up catch-all routes. Everything else is
 * a protected EPD page. Keeping the patterns here (rather than inline in
 * middleware.ts) lets us unit-test the classification without constructing a
 * Next.js request, and gives a single source of truth for "what is public".
 */
export const PUBLIC_ROUTE_PATTERNS = ["/sign-in(.*)", "/sign-up(.*)"] as const;

/**
 * Pure predicate mirroring how Clerk's `createRouteMatcher` treats the patterns
 * above: a pathname is public when it equals, or is nested under, `/sign-in` or
 * `/sign-up`. Used directly by tests; the middleware uses Clerk's matcher built
 * from the same patterns so the two stay in lock-step.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((pattern) => {
    const base = pattern.replace("(.*)", "");
    return pathname === base || pathname.startsWith(`${base}/`);
  });
}
