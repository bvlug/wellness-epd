import { SignIn } from "@clerk/nextjs";

/**
 * Clerk-hosted sign-in screen, mounted on a catch-all route so the Clerk
 * component can own its own sub-paths (e.g. SSO callbacks, factor steps).
 *
 * Return-URL preservation (EH-6): when the middleware redirects an
 * unauthenticated or expired-session user here, it appends a `redirect_url`
 * query parameter. Clerk reads that automatically and returns the user to the
 * originally requested page after a successful sign-in. When there is no
 * `redirect_url` (e.g. a direct visit), `fallbackRedirectUrl` sends the user to
 * the EPD home page.
 */
export default function SignInPage() {
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <SignIn fallbackRedirectUrl="/" signUpUrl="/sign-up" />
    </main>
  );
}
