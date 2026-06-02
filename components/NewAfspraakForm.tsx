"use client";

import {
  type AfspraakField,
  DEFAULT_DURATION_MINUTES,
  validateAfspraakInput,
} from "@/lib/afspraak-validation";
import { PATIENT_ROUTES } from "@/lib/routes";
import { useAction, useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

/**
 * "Nieuwe afspraak" form (Story A-1-S1; FR-6). A client component that selects a
 * patient (via the patient search query), a behandelaar (active behandelaars
 * only — BR-7), a future date/time, a duration (default 30 min — A-12), and an
 * optional active behandelsoort, then calls the Convex `createAfspraak` mutation.
 *
 * The server is authoritative for every rule (auth AC-2, future start BR-5,
 * behandelsoort active BR-12, overlap conflict AC-8); the form's mirror checks
 * are convenience only. A conflict is a SOFT block (A-17): the warning offers a
 * "schedule anyway" affordance that re-submits with `acknowledgeConflict`,
 * exactly like the duplicate-BSN flow in the new-patient form.
 *
 * User-facing copy is Dutch (project convention); domain terms stay Dutch. No
 * patient-identifying data is logged or echoed in errors.
 */

// Offline-safe function references (codebase pattern: avoid the generated `api`).
const createAfspraakRef = makeFunctionReference<"mutation">("afspraken:createAfspraak");
const searchPatientsRef = makeFunctionReference<"query">("patients:searchPatients");
const listBehandelaarsRef = makeFunctionReference<"action">("users:listBehandelaars");
const listBehandelsoortenRef = makeFunctionReference<"query">("behandelsoort:listActive");

interface SelectedPatient {
  patientId: string;
  achternaam: string;
  voornaam: string;
  geboortedatum: string;
}

interface Behandelaar {
  id: string;
  name: string | null;
}

interface BehandelsoortOption {
  _id: string;
  naam: string;
}

type FieldErrors = Partial<Record<AfspraakField, string>>;

/** Convert a `datetime-local` value (local time, no zone) to epoch ms, or NaN. */
function toEpochMs(localValue: string): number {
  if (localValue.trim() === "") {
    return Number.NaN;
  }
  return new Date(localValue).getTime();
}

/** Narrow an unknown thrown value to the structured creation-error payload. */
function asCreationError(
  error: unknown,
): { code: string; errors?: unknown; conflicts?: unknown } | null {
  if (error instanceof ConvexError) {
    const { data } = error;
    if (data && typeof data === "object" && "code" in data) {
      return data as { code: string };
    }
  }
  return null;
}

export function NewAfspraakForm() {
  const router = useRouter();
  const createAfspraak = useMutation(createAfspraakRef);
  const loadBehandelaars = useAction(listBehandelaarsRef);

  const behandelsoorten = useQuery(listBehandelsoortenRef, {}) as BehandelsoortOption[] | undefined;

  const [behandelaars, setBehandelaars] = useState<Behandelaar[] | null>(null);
  const [patient, setPatient] = useState<SelectedPatient | null>(null);
  const [behandelaarId, setBehandelaarId] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [duration, setDuration] = useState(String(DEFAULT_DURATION_MINUTES));
  const [behandelsoortId, setBehandelsoortId] = useState("");
  const [notities, setNotities] = useState("");

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Active behandelaars come from Clerk via an action (not reactive); load once.
  useEffect(() => {
    let cancelled = false;
    loadBehandelaars({})
      .then((list) => {
        if (!cancelled) {
          setBehandelaars(list as Behandelaar[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBehandelaars([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadBehandelaars]);

  function buildInput() {
    return {
      patientId: patient?.patientId ?? "",
      behandelaarId,
      startDatetime: toEpochMs(startLocal),
      durationMinutes: Number(duration),
      behandelsoortId: behandelsoortId || undefined,
      notities: notities || undefined,
    };
  }

  function collectFieldErrors(): FieldErrors {
    const errors: FieldErrors = {};
    for (const error of validateAfspraakInput(buildInput())) {
      errors[error.field] ??= error.message;
    }
    return errors;
  }

  async function submit(acknowledgeConflict: boolean) {
    setFormError(null);

    const clientErrors = collectFieldErrors();
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const input = buildInput();
      await createAfspraak({
        patientId: input.patientId,
        behandelaarId: input.behandelaarId,
        startDatetime: input.startDatetime,
        durationMinutes: input.durationMinutes,
        behandelsoortId: input.behandelsoortId,
        notities: input.notities,
        acknowledgeConflict: acknowledgeConflict || undefined,
      });
      // The afspraak is now in the agenda (reactive). Return to the patient's profile.
      router.push(PATIENT_ROUTES.profile(input.patientId));
    } catch (error) {
      const data = asCreationError(error);
      if (data?.code === "validation_failed" && Array.isArray(data.errors)) {
        const errors: FieldErrors = {};
        for (const e of data.errors as { field: AfspraakField; message: string }[]) {
          errors[e.field] ??= e.message;
        }
        setFieldErrors(errors);
      } else if (data?.code === "conflict") {
        setConflict(true);
      } else if (data?.code === "inactive_behandelsoort") {
        setFormError("De gekozen behandelsoort is niet meer beschikbaar. Kies een andere.");
      } else if (data?.code === "patient_inactive") {
        setFormError("Deze patiënt is gedeactiveerd en kan geen afspraak krijgen.");
      } else if (data?.code === "patient_not_found") {
        setFormError("De gekozen patiënt bestaat niet meer.");
      } else {
        setFormError("Inplannen is mislukt. Probeer het opnieuw.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConflict(false);
    void submit(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      style={{ display: "grid", gap: "1rem", maxWidth: "32rem" }}
    >
      <Field htmlFor="patient" label="Patiënt *" error={fieldErrors.patientId}>
        <PatientPicker selected={patient} onSelect={setPatient} />
      </Field>

      <Field htmlFor="behandelaar" label="Behandelaar *" error={fieldErrors.behandelaarId}>
        <select
          id="behandelaar"
          value={behandelaarId}
          onChange={(e) => setBehandelaarId(e.target.value)}
          aria-invalid={fieldErrors.behandelaarId !== undefined}
        >
          <option value="">{behandelaars === null ? "Laden…" : "Maak een keuze…"}</option>
          {(behandelaars ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name ?? b.id}
            </option>
          ))}
        </select>
      </Field>

      <Field htmlFor="start" label="Datum en tijd *" error={fieldErrors.startDatetime}>
        <input
          id="start"
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          aria-invalid={fieldErrors.startDatetime !== undefined}
        />
      </Field>

      <Field htmlFor="duration" label="Duur (minuten) *" error={fieldErrors.durationMinutes}>
        <input
          id="duration"
          type="number"
          min={5}
          step={5}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          aria-invalid={fieldErrors.durationMinutes !== undefined}
        />
      </Field>

      <Field htmlFor="behandelsoort" label="Behandelsoort">
        <select
          id="behandelsoort"
          value={behandelsoortId}
          onChange={(e) => setBehandelsoortId(e.target.value)}
        >
          <option value="">Geen / nader te bepalen</option>
          {(behandelsoorten ?? []).map((soort) => (
            <option key={soort._id} value={soort._id}>
              {soort.naam}
            </option>
          ))}
        </select>
      </Field>

      <Field htmlFor="notities" label="Notities">
        <textarea
          id="notities"
          value={notities}
          onChange={(e) => setNotities(e.target.value)}
          rows={3}
        />
      </Field>

      {conflict && (
        <div role="alert" style={{ border: "1px solid #b8860b", padding: "0.75rem" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Deze behandelaar heeft al een afspraak die overlapt met dit tijdslot.
          </p>
          <button type="button" disabled={submitting} onClick={() => void submit(true)}>
            Toch inplannen
          </button>
        </div>
      )}

      {formError !== null && (
        <p role="alert" style={{ color: "#b00020", margin: 0 }}>
          {formError}
        </p>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Bezig met inplannen…" : "Afspraak inplannen"}
      </button>
    </form>
  );
}

/**
 * Inline patient picker: searches via the `searchPatients` query (the same
 * authoritative query as the patient-search screen) and lets the user pick one
 * result. Once chosen, shows the selection with a "change" affordance. Kept local
 * to the afspraak form so the search screen component stays a navigation surface.
 */
function PatientPicker({
  selected,
  onSelect,
}: {
  selected: SelectedPatient | null;
  onSelect: (patient: SelectedPatient | null) => void;
}) {
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState<{ achternaam: string } | null>(null);
  const results = useQuery(searchPatientsRef, submitted ?? "skip") as SelectedPatient[] | undefined;

  if (selected !== null) {
    return (
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <span>
          {selected.achternaam}, {selected.voornaam} ({selected.geboortedatum})
        </span>
        <button type="button" onClick={() => onSelect(null)}>
          Wijzig
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <input
          id="patient"
          type="text"
          placeholder="Zoek op achternaam…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setSubmitted(term.trim() === "" ? null : { achternaam: term.trim() })}
        >
          Zoek
        </button>
      </div>
      {submitted !== null && results !== undefined && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: "0.25rem" }}>
          {results.length === 0 ? (
            <li style={{ color: "#555" }}>Geen patiënten gevonden.</li>
          ) : (
            results.map((result) => (
              <li key={result.patientId}>
                <button
                  type="button"
                  style={{ display: "block", width: "100%", textAlign: "left" }}
                  onClick={() => onSelect(result)}
                >
                  {result.achternaam}, {result.voornaam} ({result.geboortedatum})
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** A labelled form row with an optional inline error message (see NewPatientForm). */
function Field({
  htmlFor,
  label,
  error,
  children,
}: {
  htmlFor: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "grid", gap: "0.25rem" }}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error !== undefined && (
        <span role="alert" style={{ color: "#b00020", fontSize: "0.875rem" }}>
          {error}
        </span>
      )}
    </div>
  );
}
