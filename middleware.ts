import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Clerk middleware. At scaffold time no routes are protected yet; feature
 * stories add route protection via `createRouteMatcher` + `auth.protect()`.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless found in search params.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
