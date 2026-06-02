"use client";

import { PATIENT_ROUTES } from "@/lib/routes";
import { useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import Link from "next/link";
import { type FormEvent, useState } from "react";

/**
 * "Patiënt zoeken" screen (Story P-2-S1; FR-4). A client component that collects
 * search criteria (achternaam, voornaam, geboortedatum, BSN), calls the Convex
 * `searchPatients` query, and renders the results as links through to each
 * patient's profile — where the view itself is audited (AC-9, owned by #20).
 *
 * The server query is authoritative for every rule (BR-4 empty → no results,
 * EH-1 active-only, A-10 cap-50, BSN canonicalization). The UI mirrors only the
 * empty-criteria guard for instant feedback: it shows the "vul zoekcriteria in"
 * message and does NOT call the query until at least one criterion is entered,
 * so the screen can never be used to list every patient (BR-4).
 *
 * User-facing copy is Dutch (project convention); domain terms stay Dutch.
 *
 * AVG/GDPR (BR-11): the BSN is sent only as a search key; it is never logged and
 * never shown in the results (the query does not return it).
 */

/**
 * Offline-safe reference to the Convex query. Mirrors the codebase pattern
 * (`me.ts` / `NewPatientForm`): we name the function by its `"file:export"` path
 * instead of importing the generated `api` object (`convex/_generated` only
 * exists after codegen). Swappable for `api.patients.searchPatients` later.
 */
const searchPatientsRef = makeFunctionReference<"query">("patients:searchPatients");

/** The criteria the form collects, all as raw strings. */
interface SearchForm {
  achternaam: string;
  voornaam: string;
  geboortedatum: string;
  bsn: string;
}

/** The result shape returned by `searchPatients` (no BSN; BR-11). */
interface SearchResult {
  patientId: string;
  achternaam: string;
  voornaam: string;
  geboortedatum: string;
}

const EMPTY_FORM: SearchForm = {
  achternaam: "",
  voornaam: "",
  geboortedatum: "",
  bsn: "",
};

/** Whether at least one field carries a non-blank value (BR-4 mirror). */
function hasAnyCriteria(form: SearchForm): boolean {
  return (
    form.achternaam.trim() !== "" ||
    form.voornaam.trim() !== "" ||
    form.geboortedatum.trim() !== "" ||
    form.bsn.trim() !== ""
  );
}

/**
 * Build the Convex query arguments from the submitted criteria, omitting blank
 * fields, or `null` to mean "do not run the query" (no criteria → BR-4). Using
 * `null` (not `"skip"`) keeps this pure/testable; the component maps it to the
 * `useQuery` skip token.
 */
type SearchArgs = {
  achternaam?: string;
  voornaam?: string;
  geboortedatum?: string;
  bsn?: string;
};

function toQueryArgs(form: SearchForm): SearchArgs | null {
  if (!hasAnyCriteria(form)) {
    return null;
  }
  const args: SearchArgs = {};
  if (form.achternaam.trim() !== "") {
    args.achternaam = form.achternaam.trim();
  }
  if (form.voornaam.trim() !== "") {
    args.voornaam = form.voornaam.trim();
  }
  if (form.geboortedatum.trim() !== "") {
    args.geboortedatum = form.geboortedatum.trim();
  }
  if (form.bsn.trim() !== "") {
    args.bsn = form.bsn.trim();
  }
  return args;
}

export function PatientSearch() {
  const [form, setForm] = useState<SearchForm>(EMPTY_FORM);
  // The criteria actually submitted (drives the query); null = not yet / empty.
  const [submitted, setSubmitted] = useState<SearchArgs | null>(null);
  const [emptyNotice, setEmptyNotice] = useState(false);

  // Skip the query until a non-empty search has been submitted (BR-4).
  const results = useQuery(searchPatientsRef, submitted ?? "skip") as SearchResult[] | undefined;

  function update<K extends keyof SearchForm>(key: K, value: SearchForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const args = toQueryArgs(form);
    if (args === null) {
      // BR-4: no criteria → message, no query, zero results.
      setSubmitted(null);
      setEmptyNotice(true);
      return;
    }
    setEmptyNotice(false);
    setSubmitted(args);
  }

  const loading = submitted !== null && results === undefined;

  return (
    <div style={{ display: "grid", gap: "1.5rem", maxWidth: "40rem" }}>
      <form onSubmit={onSubmit} noValidate style={{ display: "grid", gap: "1rem" }}>
        <Field htmlFor="achternaam" label="Achternaam">
          <input
            id="achternaam"
            type="text"
            value={form.achternaam}
            onChange={(e) => update("achternaam", e.target.value)}
          />
        </Field>

        <Field htmlFor="voornaam" label="Voornaam">
          <input
            id="voornaam"
            type="text"
            value={form.voornaam}
            onChange={(e) => update("voornaam", e.target.value)}
          />
        </Field>

        <Field htmlFor="geboortedatum" label="Geboortedatum">
          <input
            id="geboortedatum"
            type="date"
            value={form.geboortedatum}
            onChange={(e) => update("geboortedatum", e.target.value)}
          />
        </Field>

        <Field htmlFor="bsn" label="BSN">
          <input
            id="bsn"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={form.bsn}
            onChange={(e) => update("bsn", e.target.value)}
          />
        </Field>

        <button type="submit">Zoeken</button>
      </form>

      {emptyNotice && (
        <p role="alert" style={{ margin: 0 }}>
          Vul zoekcriteria in.
        </p>
      )}

      {loading && <p style={{ margin: 0 }}>Bezig met zoeken…</p>}

      {submitted !== null && results !== undefined && <SearchResults results={results} />}
    </div>
  );
}

/**
 * Renders the results list, or a "no matches" message. Each row shows
 * achternaam, voornaam, and geboortedatum, and links to the patient's profile
 * via {@link PATIENT_ROUTES.profile}; following that link is where the view is
 * audited (AC-9, owned by #20).
 */
function SearchResults({ results }: { results: SearchResult[] }) {
  if (results.length === 0) {
    return <output style={{ margin: 0 }}>Geen patiënten gevonden.</output>;
  }
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.5rem" }}>
      {results.map((result) => (
        <li key={result.patientId}>
          <Link
            href={PATIENT_ROUTES.profile(result.patientId)}
            style={{ display: "block", border: "1px solid #ccc", padding: "0.75rem" }}
          >
            <strong>
              {result.achternaam}, {result.voornaam}
            </strong>
            <span style={{ display: "block", color: "#555", fontSize: "0.875rem" }}>
              Geboortedatum: {result.geboortedatum}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A labelled form row. The label is explicitly associated with its control via
 * `htmlFor` (matching the control's `id`) for accessibility.
 */
function Field({
  htmlFor,
  label,
  children,
}: {
  htmlFor: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}
