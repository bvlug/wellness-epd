"use client";

import type { Role } from "@/convex/auth";
import { ROLES } from "@/convex/auth";
import type { StaffUser } from "@/convex/users";
import { useUser } from "@clerk/nextjs";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useEffect, useState } from "react";
import { assignRoleRef, listUsersRef, removeRoleRef } from "./roleActions";

/**
 * Admin user & role management screen (Story F-3-S2).
 *
 * Lists every Clerk user with their current EPD role(s) and lets an admin assign
 * or remove the `balie` / `behandelaar` / `admin` roles. The role data lives in
 * Clerk `public_metadata.roles`; all reads/writes go through the admin-only
 * Convex actions in convex/users.ts.
 *
 * Two layers of access control, by design:
 *   1. SERVER (the real boundary): every action starts with
 *      `assertHasRole(["admin"])`. A non-admin's `listUsers` call throws a
 *      permission-denied ConvexError and returns no user data — even if they
 *      bypass the UI.
 *   2. CLIENT (UX only, AC-4): we read the signed-in user's own admin role from
 *      Clerk and show an access-denied panel to non-admins, so they never see an
 *      empty table or a raw error. This check is convenience, not security.
 *
 * Styling matches the sober inline-style aesthetic of the existing pages; no UI
 * framework is pulled in for the POC.
 */

/** Reads the signed-in user's own roles from their Clerk public metadata. */
function useOwnRoles(): { ready: boolean; roles: string[] } {
  const { isLoaded, user } = useUser();
  if (!isLoaded) {
    return { ready: false, roles: [] };
  }
  const raw = user?.publicMetadata?.roles;
  const roles = Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
  return { ready: true, roles };
}

/** Turn an unknown thrown value into a short, non-sensitive message. */
function describeError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | undefined;
    if (data?.code === "permission_denied") {
      return "Je hebt geen beheerdersrechten voor deze actie.";
    }
    if (data?.code === "clerk_not_configured") {
      return "Clerk is niet geconfigureerd op de server (CLERK_SECRET_KEY ontbreekt).";
    }
  }
  return "Er ging iets mis. Probeer het opnieuw.";
}

const td: React.CSSProperties = {
  borderBottom: "1px solid #e5e5e5",
  padding: "0.5rem 0.75rem",
  textAlign: "left",
  verticalAlign: "top",
};

const th: React.CSSProperties = {
  ...td,
  borderBottom: "2px solid #ccc",
  fontWeight: 600,
};

export default function AdminUsersPage() {
  const { ready, roles: ownRoles } = useOwnRoles();
  const isAdmin = ownRoles.includes("admin");

  const listUsers = useAction(listUsersRef);
  const assignRole = useAction(assignRoleRef);
  const removeRole = useAction(removeRoleRef);

  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Per-user-per-role in-flight flag, keyed `${userId}:${role}`.
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await listUsers({}));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLoading(false);
    }
  }, [listUsers]);

  useEffect(() => {
    // Only the server enforces access, but skip the call entirely for non-admins
    // so they get the access-denied panel instead of a thrown error (AC-4).
    if (ready && isAdmin) {
      void refresh();
    }
  }, [ready, isAdmin, refresh]);

  // Single-admin assumption (POC): the role model is a read-modify-write on
  // Clerk metadata, so two admins toggling the same user's roles concurrently
  // would be last-write-wins. Accepted for this POC — admin actions are rare and
  // single-operator; revisit (optimistic concurrency / server-side merge) before
  // multi-admin production use.
  const toggleRole = useCallback(
    async (user: StaffUser, role: Role, hasRole: boolean) => {
      const key = `${user.id}:${role}`;
      setBusy((b) => ({ ...b, [key]: true }));
      setError(null);
      try {
        const updated = hasRole
          ? await removeRole({ userId: user.id, role })
          : await assignRole({ userId: user.id, role });
        setUsers((prev) => (prev ? prev.map((u) => (u.id === updated.id ? updated : u)) : prev));
      } catch (err) {
        setError(describeError(err));
      } finally {
        setBusy((b) => {
          const next = { ...b };
          delete next[key];
          return next;
        });
      }
    },
    [assignRole, removeRole],
  );

  if (!ready) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <p>Laden…</p>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ marginTop: 0 }}>Geen toegang</h1>
        <p>
          Deze pagina is alleen toegankelijk voor beheerders. Je huidige account heeft geen
          beheerdersrol.
        </p>
      </main>
    );
  }

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
        <h1 style={{ margin: 0 }}>Gebruikers en rollen</h1>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          {loading ? "Vernieuwen…" : "Vernieuwen"}
        </button>
      </header>

      <p style={{ color: "#555", maxWidth: "60ch" }}>
        Beheer welke rollen elke gebruiker heeft. Een roluitbreiding wordt actief bij de volgende
        aanroep van de betreffende gebruiker.
      </p>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      {users && users.length === 0 && !loading && <p>Geen gebruikers gevonden.</p>}

      {users && users.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th style={th}>Naam</th>
              <th style={th}>E-mail</th>
              {ROLES.map((role) => (
                <th key={role} style={{ ...th, textAlign: "center" }}>
                  {role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={td}>{user.name ?? <em style={{ color: "#888" }}>—</em>}</td>
                <td style={td}>{user.email ?? <em style={{ color: "#888" }}>—</em>}</td>
                {ROLES.map((role) => {
                  const hasRole = user.roles.includes(role);
                  const key = `${user.id}:${role}`;
                  const isBusy = busy[key] ?? false;
                  return (
                    <td key={role} style={{ ...td, textAlign: "center" }}>
                      <label style={{ display: "inline-flex", gap: "0.35rem", cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={hasRole}
                          disabled={isBusy}
                          onChange={() => void toggleRole(user, role, hasRole)}
                          aria-label={`${role} voor ${user.email ?? user.id}`}
                        />
                        {isBusy ? "…" : hasRole ? "ja" : "nee"}
                      </label>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
