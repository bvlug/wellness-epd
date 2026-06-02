import { PUBLIC_ROUTE_PATTERNS } from "@/lib/routes";
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Routes that must remain reachable without an authenticated Clerk session.
 *
 * Everything not matched here is treated as a protected EPD page and requires a
 * signed-in user. The patterns live in `@/lib/routes` so they can be unit-tested
 * independently of the Next.js request object; the Clerk auth UI lives under
 * `/sign-in` and `/sign-up` (catch-all routes), so those prefixes are public —
 * otherwise an unauthenticated user could never reach the sign-in screen.
 */
const isPublicRoute = createRouteMatcher([...PUBLIC_ROUTE_PATTERNS]);

/**
 * Clerk middleware enforcing route protection for the EPD.
 *
 * For any non-public route, `auth.protect()` is called: when there is no valid
 * Clerk session it redirects the browser to the sign-in page, preserving the
 * originally requested URL via Clerk's `redirect_url` query parameter so the
 * user is returned there after authenticating (covers session-expiry / EH-6).
 * For non-document requests (e.g. API routes) `auth.protect()` responds with a
 * 404 instead of redirecting, so no protected payload leaks to unauthenticated
 * callers.
 *
 * This is the frontend/edge gate only. It does NOT replace per-function
 * authorization: every Convex function that touches patient data must still
 * verify `ctx.auth.getUserIdentity()` itself (see convex/auth.ts).
 */
export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
