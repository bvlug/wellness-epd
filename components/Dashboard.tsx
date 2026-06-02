"use client";

import Link from "next/link";
import { useOwnRoles } from "./useOwnRoles";

interface DashboardCard {
  href: string;
  title: string;
  description: string;
}

/** Patient management — available to every authenticated staff member. */
const PATIENT_CARDS: ReadonlyArray<DashboardCard> = [
  {
    href: "/patienten/zoeken",
    title: "Patiënt zoeken",
    description: "Zoek op naam, geboortedatum of BSN en open een patiëntdossier.",
  },
  {
    href: "/patienten/nieuw",
    title: "Nieuwe patiënt",
    description: "Registreer een nieuwe patiënt met basisgegevens.",
  },
];

/** Admin-only management screens. */
const ADMIN_CARDS: ReadonlyArray<DashboardCard> = [
  {
    href: "/admin/behandelsoorten",
    title: "Behandelsoorten",
    description: "Beheer de lijst met behandelsoorten die staf kan kiezen.",
  },
  {
    href: "/admin/users",
    title: "Gebruikers & rollen",
    description: "Ken rollen (balie, behandelaar, admin) toe of trek ze in.",
  },
];

/** Modules that the MVP scopes but that are not built yet. */
const UPCOMING = ["Afspraken & agenda", "Behandelingen"];

const cardStyle: React.CSSProperties = {
  display: "block",
  padding: "1rem 1.25rem",
  border: "1px solid #e5e5e5",
  borderRadius: 8,
  textDecoration: "none",
  color: "inherit",
  minWidth: 240,
  flex: "1 1 260px",
};

const gridStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "1rem",
  marginBottom: "2rem",
};

function CardGrid({ cards }: { cards: ReadonlyArray<DashboardCard> }) {
  return (
    <div style={gridStyle}>
      {cards.map((card) => (
        <Link key={card.href} href={card.href} style={cardStyle}>
          <strong style={{ color: "#1a4d8f" }}>{card.title}</strong>
          <p style={{ margin: "0.4rem 0 0", color: "#444" }}>{card.description}</p>
        </Link>
      ))}
    </div>
  );
}

/**
 * The authenticated home dashboard. A role-aware hub that links the built EPD
 * screens so they are discoverable instead of direct-URL only: patient screens
 * for every staff member, the management screens for admins. Modules still on
 * the backlog are listed as "binnenkort" so the scope is visible without
 * dangling links. Role gating here is UX only — the destinations enforce
 * authorization server-side.
 */
export function Dashboard() {
  const { ready, roles } = useOwnRoles();
  const isAdmin = roles.includes("admin");

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>Wellness EPD</h1>

      <section>
        <h2 style={{ fontSize: "1.1rem" }}>Patiëntbeheer</h2>
        <CardGrid cards={PATIENT_CARDS} />
      </section>

      {ready && isAdmin && (
        <section>
          <h2 style={{ fontSize: "1.1rem" }}>Beheer</h2>
          <CardGrid cards={ADMIN_CARDS} />
        </section>
      )}

      <section>
        <h2 style={{ fontSize: "1.1rem" }}>Binnenkort beschikbaar</h2>
        <p style={{ color: "#666" }}>{UPCOMING.join(" · ")}</p>
      </section>
    </main>
  );
}
