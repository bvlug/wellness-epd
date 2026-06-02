import { Dashboard } from "@/components/Dashboard";

/**
 * EPD home page — the authenticated dashboard.
 *
 * This route is protected by the Clerk middleware, so reaching it implies an
 * authenticated session: a successful sign-in redirects here. The session
 * affordance (UserButton) lives in the persistent {@link AppNav} rendered by the
 * root layout; this page renders the role-aware {@link Dashboard} that links the
 * built EPD screens.
 */
export default function HomePage() {
  return <Dashboard />;
}
