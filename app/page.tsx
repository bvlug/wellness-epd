import { UserButton } from "@clerk/nextjs";

/**
 * EPD home page.
 *
 * This route is protected by the Clerk middleware, so reaching it implies an
 * authenticated session: a successful sign-in redirects here. The `UserButton`
 * exposes the active session and a sign-out affordance; from this point Convex
 * queries carry the Clerk JWT via ConvexProviderWithClerk.
 */
export default function HomePage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1.5rem",
        }}
      >
        <h1 style={{ margin: 0 }}>Wellness EPD</h1>
        <UserButton />
      </header>
      <p>
        Je bent ingelogd. Patiëntbeheer, afspraken en behandelingen worden in volgende stories aan
        deze beveiligde omgeving toegevoegd.
      </p>
    </main>
  );
}
