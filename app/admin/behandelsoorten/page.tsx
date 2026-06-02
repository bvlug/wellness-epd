"use client";

import type { BehandelsoortAdminRow } from "@/convex/behandelsoort";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { type FormEvent, useCallback, useState } from "react";
import {
  type BehandelsoortId,
  createBehandelsoortRef,
  deactivateBehandelsoortRef,
  deleteBehandelsoortRef,
  listAllForAdminRef,
  renameBehandelsoortRef,
} from "./behandelsoortActions";

/**
 * Behandelsoort vocabulary management screen (Story B-3-S2; FR-19, A-27, A-28).
 *
 * An admin curates the controlled treatment-type vocabulary: create a new
 * entry, rename one, deactivate (soft-delete) one, or hard-delete one that is
 * not referenced. The controls map 1:1 to the admin-only Convex mutations in
 * convex/behandelsoort.ts.
 *
 * Two layers of access control, by design (mirrors app/admin/users):
 *   1. SERVER (the real boundary, A-28): every query/mutation starts with
 *      `assertHasRole(ctx, ["admin"])`. A non-admin's call throws a
 *      permission-denied ConvexError and reads/writes nothing — even if they
 *      bypass the UI.
 *   2. CLIENT (UX only): we read the signed-in user's own admin role from Clerk
 *      and show an access-denied panel to non-admins so they never see an empty
 *      table or a raw error. This check is convenience, not security.
 *
 * A-27: a hard-delete of a referenced entry is refused by the server with a
 * `behandelsoort_referenced` error; the screen surfaces a Dutch "in gebruik"
 * message and the entry remains. Deactivation is the normal removal path.
 *
 * User-facing copy is Dutch (project convention); domain terms stay Dutch.
 * Styling matches the sober inline-style aesthetic of the existing pages.
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

/** Turn an unknown thrown value into a short, non-sensitive Dutch message. */
function describeError(error: unknown): string {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string; reason?: string } | undefined;
    if (data?.code === "permission_denied") {
      return "Je hebt geen beheerdersrechten voor deze actie.";
    }
    if (data?.code === "behandelsoort_referenced") {
      return "Deze behandelsoort is in gebruik door een afspraak of behandeling en kan niet worden verwijderd. Deactiveer de behandelsoort in plaats daarvan.";
    }
    if (data?.code === "behandelsoort_not_found") {
      return "Deze behandelsoort bestaat niet meer.";
    }
    if (data?.code === "invalid_naam") {
      return data.reason === "too_long"
        ? "De naam is te lang."
        : "Geef een naam op voor de behandelsoort.";
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

export default function BehandelsoortenBeheerPage() {
  const { ready, roles: ownRoles } = useOwnRoles();
  const isAdmin = ownRoles.includes("admin");

  // Only call the admin query for admins, so a non-admin gets the access-denied
  // panel instead of a thrown permission error in the console (A-28 server-side
  // is still the real boundary; this is UX). Passing `"skip"` halts the query.
  const rows = useQuery(listAllForAdminRef, isAdmin ? {} : "skip") as
    | BehandelsoortAdminRow[]
    | undefined;

  const createBehandelsoort = useMutation(createBehandelsoortRef);
  const renameBehandelsoort = useMutation(renameBehandelsoortRef);
  const deactivateBehandelsoort = useMutation(deactivateBehandelsoortRef);
  const deleteBehandelsoort = useMutation(deleteBehandelsoortRef);

  const [newNaam, setNewNaam] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Id of the row being renamed, plus its draft value.
  const [editing, setEditing] = useState<{ id: BehandelsoortId; naam: string } | null>(null);

  const runAction = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const onCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const naam = newNaam.trim();
      if (naam.length === 0) {
        setError("Geef een naam op voor de behandelsoort.");
        return;
      }
      const ok = await runAction(() => createBehandelsoort({ naam }));
      if (ok) {
        setNewNaam("");
      }
    },
    [newNaam, runAction, createBehandelsoort],
  );

  const onRenameSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (editing === null) {
        return;
      }
      const naam = editing.naam.trim();
      if (naam.length === 0) {
        setError("Geef een naam op voor de behandelsoort.");
        return;
      }
      const ok = await runAction(() => renameBehandelsoort({ id: editing.id, naam }));
      if (ok) {
        setEditing(null);
      }
    },
    [editing, runAction, renameBehandelsoort],
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
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif", maxWidth: "48rem" }}>
      <h1 style={{ marginTop: 0 }}>Behandelsoorten beheren</h1>
      <p style={{ color: "#555", maxWidth: "60ch" }}>
        Beheer de lijst met behandelsoorten die balie en behandelaars kunnen kiezen bij afspraken en
        behandelingen. Een gedeactiveerde behandelsoort verdwijnt uit de keuzelijst, maar blijft
        zichtbaar bij bestaande afspraken en behandelingen die ernaar verwijzen.
      </p>

      <form onSubmit={onCreate} style={{ display: "flex", gap: "0.5rem", margin: "1.5rem 0" }}>
        <input
          type="text"
          value={newNaam}
          onChange={(e) => setNewNaam(e.target.value)}
          placeholder="Nieuwe behandelsoort, bijv. Sportmassage"
          aria-label="Naam van de nieuwe behandelsoort"
          style={{ flex: 1, padding: "0.4rem 0.5rem" }}
        />
        <button type="submit" disabled={busy}>
          {busy ? "Bezig…" : "Toevoegen"}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      {rows === undefined && <p>Laden…</p>}
      {rows !== undefined && rows.length === 0 && <p>Er zijn nog geen behandelsoorten.</p>}

      {rows !== undefined && rows.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginTop: "1rem" }}>
          <thead>
            <tr>
              <th style={th}>Naam</th>
              <th style={{ ...th, textAlign: "center" }}>Status</th>
              <th style={{ ...th, textAlign: "right" }}>Acties</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isEditing = editing?.id === row._id;
              return (
                <tr key={row._id}>
                  <td style={td}>
                    {isEditing ? (
                      <form onSubmit={onRenameSubmit} style={{ display: "flex", gap: "0.5rem" }}>
                        <input
                          type="text"
                          value={editing.naam}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev === null ? prev : { ...prev, naam: e.target.value },
                            )
                          }
                          aria-label={`Nieuwe naam voor ${row.naam}`}
                          style={{ flex: 1, padding: "0.3rem 0.4rem" }}
                        />
                        <button type="submit" disabled={busy}>
                          Opslaan
                        </button>
                        <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                          Annuleren
                        </button>
                      </form>
                    ) : (
                      row.naam
                    )}
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    {row.actief ? "Actief" : <span style={{ color: "#888" }}>Gedeactiveerd</span>}
                  </td>
                  <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setEditing({ id: row._id, naam: row.naam })}
                        >
                          Hernoemen
                        </button>{" "}
                        {row.actief && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void runAction(() => deactivateBehandelsoort({ id: row._id }))
                            }
                          >
                            Deactiveren
                          </button>
                        )}{" "}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runAction(() => deleteBehandelsoort({ id: row._id }))}
                        >
                          Verwijderen
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
