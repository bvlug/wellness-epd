"use client";

import type { AfspraakSummary, BehandelingSummary, PatientProfileView } from "@/convex/patients";
import type { GESLACHT_VALUES } from "@/convex/schema";
import { PATIENT_ROUTES } from "@/lib/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Patiëntprofiel — read-only profile view (Story P-1-S2; FR-3, AC-1, AC-9,
 * BR-3). A client component that, on mount, calls the Convex
 * `patients:getPatientForView` path and renders all FR-1 fields (including the
 * full BSN, BR-3), an upcoming-afspraken summary, and the last five
 * behandelingen with a "view full history" link.
 *
 * **Why a mutation, not a query.** AC-9 requires writing a `view` audit entry
 * when the profile opens, and a Convex query is read-only (AC-7). The view path
 * is therefore a mutation that reads the patient AND writes the audit row in one
 * transaction; we invoke it once when this component mounts (see the
 * fired-once guard below — React Strict Mode mounts effects twice in dev, and we
 * want exactly one audited view per page load).
 *
 * **Auth (AC-1).** The Clerk middleware redirects an unauthenticated browser to
 * sign-in before this page renders; independently, the Convex path authorizes
 * the identity server-side and returns no patient data without one. This
 * component only renders patient data it actually received from that authorized
 * call.
 *
 * User-facing copy is Dutch (project convention); domain terms stay Dutch.
 */

/**
 * Offline-safe reference to the Convex view mutation, named by its
 * `"file:export"` path. Mirrors the codebase pattern (NewPatientForm,
 * roleActions) of avoiding the gitignored generated `api` object; the explicit
 * type args restore end-to-end typing of the call.
 */
const getPatientForViewRef = makeFunctionReference<
  "mutation",
  { patientId: string },
  PatientProfileView
>("patients:getPatientForView");

const GESLACHT_LABELS: Record<(typeof GESLACHT_VALUES)[number], string> = {
  man: "Man",
  vrouw: "Vrouw",
  overig: "Overig",
  onbekend: "Onbekend",
};

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; data: PatientProfileView }
  | { status: "not_found" }
  | { status: "error" };

/** Format an ISO `YYYY-MM-DD` date as Dutch `dd-mm-jjjj`, leaving other input as-is. */
function formatIsoDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) {
    return iso;
  }
  const [, year, month, day] = match;
  return `${day}-${month}-${year}`;
}

/** Format an epoch-millis afspraak start as a Dutch date + time. */
function formatDateTime(epochMillis: number): string {
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(epochMillis));
}

/** Compose the display name from the optional tussenvoegsel (BR: name parts). */
function fullName(p: PatientProfileView["patient"]): string {
  const middle = p.tussenvoegsel ? `${p.tussenvoegsel} ` : "";
  return `${p.voornaam} ${middle}${p.achternaam}`;
}

export function PatientProfile({ patientId }: { patientId: string }) {
  const getPatientForView = useMutation(getPatientForViewRef);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  // Fire the audited view exactly once per page load. A ref guard prevents the
  // double-invocation React Strict Mode triggers in development, so we never log
  // two `view` audit entries for a single profile open (AC-9).
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) {
      return;
    }
    firedRef.current = true;
    void (async () => {
      try {
        const data = await getPatientForView({ patientId });
        setState({ status: "loaded", data });
      } catch (error) {
        if (error instanceof ConvexError) {
          const data = error.data as { code?: string } | undefined;
          if (data?.code === "patient_not_found") {
            setState({ status: "not_found" });
            return;
          }
        }
        setState({ status: "error" });
      }
    })();
  }, [getPatientForView, patientId]);

  if (state.status === "loading") {
    return <p>Profiel laden…</p>;
  }

  if (state.status === "not_found") {
    return (
      <div role="alert">
        <p>Deze patiënt bestaat niet (meer).</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p role="alert" style={{ color: "#b00020" }}>
        Het profiel kon niet worden geladen. Probeer het opnieuw.
      </p>
    );
  }

  const { patient, upcomingAfspraken, recentBehandelingen } = state.data;

  return (
    <div style={{ display: "grid", gap: "2rem", maxWidth: "48rem" }}>
      <section aria-labelledby="patient-heading">
        <header style={{ display: "flex", alignItems: "baseline", gap: "0.75rem" }}>
          <h2 id="patient-heading" style={{ margin: 0 }}>
            {fullName(patient)}
          </h2>
          {!patient.actief && (
            <span style={{ color: "#b00020", fontSize: "0.875rem" }}>(gedeactiveerd)</span>
          )}
        </header>

        <dl style={{ display: "grid", gridTemplateColumns: "12rem 1fr", gap: "0.4rem 1rem" }}>
          <Detail label="Voornaam" value={patient.voornaam} />
          <Detail label="Tussenvoegsel" value={patient.tussenvoegsel} />
          <Detail label="Achternaam" value={patient.achternaam} />
          <Detail label="Geboortedatum" value={formatIsoDate(patient.geboortedatum)} />
          <Detail label="Geslacht" value={GESLACHT_LABELS[patient.geslacht]} />
          {/* BR-3: the full BSN is shown to authorized staff by design. */}
          <Detail label="BSN" value={patient.bsn} />
          <Detail label="E-mailadres" value={patient.email} />
          <Detail label="Telefoonnummer" value={patient.telefoonnummer} />
          <Detail
            label="Adres"
            value={
              patient.adres
                ? `${patient.adres.straat} ${patient.adres.huisnummer}, ${patient.adres.postcode} ${patient.adres.stad}`
                : undefined
            }
          />
          <Detail label="Notities" value={patient.notities} />
        </dl>
      </section>

      <section aria-labelledby="afspraken-heading">
        <h2 id="afspraken-heading" style={{ marginBottom: "0.5rem" }}>
          Aankomende afspraken
        </h2>
        {upcomingAfspraken.length === 0 ? (
          <p style={{ color: "#555" }}>Geen aankomende afspraken.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {upcomingAfspraken.map((afspraak: AfspraakSummary) => (
              <li key={afspraak._id}>
                {formatDateTime(afspraak.startDatetime)} — {afspraak.durationMinutes} min ({" "}
                {afspraak.status})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="behandelingen-heading">
        <h2 id="behandelingen-heading" style={{ marginBottom: "0.5rem" }}>
          Recente behandelingen
        </h2>
        {recentBehandelingen.length === 0 ? (
          <p style={{ color: "#555" }}>Geen behandelingen.</p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {recentBehandelingen.map((behandeling: BehandelingSummary) => (
              <li key={behandeling._id}>
                {formatIsoDate(behandeling.treatmentDate)} ({behandeling.status})
              </li>
            ))}
          </ul>
        )}
        <p style={{ marginTop: "0.75rem" }}>
          <Link href={PATIENT_ROUTES.history(patient._id)}>
            Volledige behandelhistorie bekijken
          </Link>
        </p>
      </section>
    </div>
  );
}

/**
 * A single definition-list row. An absent optional value renders a muted dash so
 * the layout stays aligned and missing data is unambiguous.
 */
function Detail({ label, value }: { label: string; value?: string }): ReactNode {
  return (
    <>
      <dt style={{ fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: 0 }}>{value ? value : <span style={{ color: "#888" }}>—</span>}</dd>
    </>
  );
}
