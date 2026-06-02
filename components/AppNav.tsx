"use client";

import { SignedIn, UserButton } from "@clerk/nextjs";
import Link from "next/link";
import { useOwnRoles } from "./useOwnRoles";

/** Destinations available to every authenticated staff member. */
const STAFF_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/patienten/zoeken", label: "Patiënt zoeken" },
  { href: "/patienten/nieuw", label: "Nieuwe patiënt" },
];

/**
 * Admin-only destinations. Shown only to admins as a convenience; the screens
 * and their Convex functions enforce the `admin` role server-side regardless.
 */
const ADMIN_LINKS: ReadonlyArray<{ href: string; label: string }> = [
  { href: "/admin/behandelsoorten", label: "Behandelsoorten" },
  { href: "/admin/users", label: "Gebruikers" },
];

const navStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1.25rem",
  padding: "0.75rem 1.5rem",
  borderBottom: "1px solid #e5e5e5",
  fontFamily: "system-ui, sans-serif",
};

const brandStyle: React.CSSProperties = {
  fontWeight: 600,
  textDecoration: "none",
  color: "inherit",
};

const linkStyle: React.CSSProperties = { textDecoration: "none", color: "#1a4d8f" };

/**
 * Persistent top navigation, rendered only for signed-in users (Clerk
 * `<SignedIn>`) so it never appears on the sign-in/sign-up pages. Links to the
 * patient screens for all staff and to the admin screens for admins only, plus
 * the Clerk `UserButton` (session + sign-out).
 */
export function AppNav() {
  const { roles } = useOwnRoles();
  const isAdmin = roles.includes("admin");

  return (
    <SignedIn>
      <nav style={navStyle}>
        <Link href="/" style={brandStyle}>
          Wellness EPD
        </Link>
        <div style={{ display: "flex", gap: "1rem", flex: 1 }}>
          {STAFF_LINKS.map((link) => (
            <Link key={link.href} href={link.href} style={linkStyle}>
              {link.label}
            </Link>
          ))}
          {isAdmin &&
            ADMIN_LINKS.map((link) => (
              <Link key={link.href} href={link.href} style={linkStyle}>
                {link.label}
              </Link>
            ))}
        </div>
        <UserButton />
      </nav>
    </SignedIn>
  );
}
