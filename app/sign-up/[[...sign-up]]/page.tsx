import { SignUp } from "@clerk/nextjs";

/**
 * Clerk-hosted sign-up screen on a catch-all route (mirrors the sign-in page).
 *
 * After completing sign-up the user is sent to the EPD home page via
 * `fallbackRedirectUrl`; a `redirect_url` query parameter, when present, takes
 * precedence and returns the user to the originally requested page.
 */
export default function SignUpPage() {
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <SignUp fallbackRedirectUrl="/" signInUrl="/sign-in" />
    </main>
  );
}
