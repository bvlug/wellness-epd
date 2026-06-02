"use client";

import type { PatientCreationErrorData } from "@/convex/patients";
import { GESLACHT_VALUES } from "@/convex/schema";
import {
  type PatientField,
  type PatientInput,
  validatePatientInput,
} from "@/lib/patient-validation";
import { PATIENT_ROUTES } from "@/lib/routes";
import { useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useState } from "react";

/**
 * "Nieuwe patiënt" form (Story P-1-S1; FR-1). A client component that collects
 * the required and optional patient fields, runs the SHARED
 * {@link validatePatientInput} for instant client-side feedback, and calls the
 * Convex `createPatient` mutation — which re-validates and authorizes
 * server-side (the form's checks are convenience only; the server is the
 * authority, AC-2). On success it redirects to the new patient's profile page.
 *
 * User-facing copy is Dutch (project convention); domain terms stay Dutch.
 *
 * AVG/GDPR (BR-11): the BSN value is never written to the console or shown back
 * inside an error message — field errors reference the field, not the value.
 */

/**
 * Offline-safe reference to the Convex mutation. Mirrors the codebase pattern
 * (`me.ts` uses `queryGeneric`): we avoid importing the generated `api` object
 * (`convex/_generated` is gitignored and only exists after codegen) and instead
 * name the function by its `"file:export"` path. Once codegen has run this can
 * be swapped for `api.patients.createPatient` without changing behavior.
 */
const createPatientRef = makeFunctionReference<"mutation">("patients:createPatient");

type FieldErrors = Partial<Record<PatientField, string>>;

const GESLACHT_LABELS: Record<(typeof GESLACHT_VALUES)[number], string> = {
  man: "Man",
  vrouw: "Vrouw",
  overig: "Overig",
  onbekend: "Onbekend",
};

const EMPTY_FORM: PatientInput = {
  voornaam: "",
  tussenvoegsel: "",
  achternaam: "",
  geboortedatum: "",
  geslacht: "",
  bsn: "",
  email: "",
  telefoonnummer: "",
  notities: "",
};

/** Narrow an unknown thrown value to the structured creation-error payload. */
function asCreationError(error: unknown): PatientCreationErrorData | null {
  if (error instanceof ConvexError) {
    const { data } = error;
    if (data && typeof data === "object" && "code" in data) {
      return data as PatientCreationErrorData;
    }
  }
  return null;
}

export function NewPatientForm() {
  const router = useRouter();
  const createPatient = useMutation(createPatientRef);

  const [form, setForm] = useState<PatientInput>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ canOverride: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function update<K extends keyof PatientInput>(key: K, value: PatientInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function collectFieldErrors(input: PatientInput): FieldErrors {
    const errors: FieldErrors = {};
    for (const error of validatePatientInput(input)) {
      // Keep the first message per field.
      errors[error.field] ??= error.message;
    }
    return errors;
  }

  async function submit(acknowledgeDuplicate: boolean) {
    setFormError(null);

    const clientErrors = collectFieldErrors(form);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      const result = await createPatient({
        voornaam: form.voornaam,
        tussenvoegsel: form.tussenvoegsel || undefined,
        achternaam: form.achternaam,
        geboortedatum: form.geboortedatum,
        geslacht: form.geslacht as (typeof GESLACHT_VALUES)[number],
        bsn: form.bsn,
        email: form.email || undefined,
        telefoonnummer: form.telefoonnummer || undefined,
        notities: form.notities || undefined,
        acknowledgeDuplicate: acknowledgeDuplicate || undefined,
      });
      router.push(PATIENT_ROUTES.profile(result.patientId));
    } catch (error) {
      const data = asCreationError(error);
      if (data?.code === "validation_failed") {
        const errors: FieldErrors = {};
        for (const e of data.errors) {
          errors[e.field] ??= e.message;
        }
        setFieldErrors(errors);
      } else if (data?.code === "duplicate_bsn") {
        setDuplicate({ canOverride: data.canOverride });
      } else {
        setFormError("Aanmaken is mislukt. Probeer het opnieuw.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDuplicate(null);
    void submit(false);
  }

  return (
    <form
      onSubmit={onSubmit}
      noValidate
      style={{ display: "grid", gap: "1rem", maxWidth: "32rem" }}
    >
      <Field htmlFor="voornaam" label="Voornaam *" error={fieldErrors.voornaam}>
        <input
          id="voornaam"
          type="text"
          value={form.voornaam}
          onChange={(e) => update("voornaam", e.target.value)}
          aria-invalid={fieldErrors.voornaam !== undefined}
        />
      </Field>

      <Field htmlFor="tussenvoegsel" label="Tussenvoegsel">
        <input
          id="tussenvoegsel"
          type="text"
          value={form.tussenvoegsel}
          onChange={(e) => update("tussenvoegsel", e.target.value)}
        />
      </Field>

      <Field htmlFor="achternaam" label="Achternaam *" error={fieldErrors.achternaam}>
        <input
          id="achternaam"
          type="text"
          value={form.achternaam}
          onChange={(e) => update("achternaam", e.target.value)}
          aria-invalid={fieldErrors.achternaam !== undefined}
        />
      </Field>

      <Field htmlFor="geboortedatum" label="Geboortedatum *" error={fieldErrors.geboortedatum}>
        <input
          id="geboortedatum"
          type="date"
          value={form.geboortedatum}
          onChange={(e) => update("geboortedatum", e.target.value)}
          aria-invalid={fieldErrors.geboortedatum !== undefined}
        />
      </Field>

      <Field htmlFor="geslacht" label="Geslacht *" error={fieldErrors.geslacht}>
        <select
          id="geslacht"
          value={form.geslacht}
          onChange={(e) => update("geslacht", e.target.value)}
          aria-invalid={fieldErrors.geslacht !== undefined}
        >
          <option value="">Maak een keuze…</option>
          {GESLACHT_VALUES.map((value) => (
            <option key={value} value={value}>
              {GESLACHT_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field htmlFor="bsn" label="BSN *" error={fieldErrors.bsn}>
        <input
          id="bsn"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={form.bsn}
          onChange={(e) => update("bsn", e.target.value)}
          aria-invalid={fieldErrors.bsn !== undefined}
        />
      </Field>

      <Field htmlFor="email" label="E-mailadres">
        <input
          id="email"
          type="email"
          value={form.email}
          onChange={(e) => update("email", e.target.value)}
        />
      </Field>

      <Field htmlFor="telefoonnummer" label="Telefoonnummer">
        <input
          id="telefoonnummer"
          type="tel"
          value={form.telefoonnummer}
          onChange={(e) => update("telefoonnummer", e.target.value)}
        />
      </Field>

      <Field htmlFor="notities" label="Notities">
        <textarea
          id="notities"
          value={form.notities}
          onChange={(e) => update("notities", e.target.value)}
          rows={3}
        />
      </Field>

      {duplicate !== null && (
        <div role="alert" style={{ border: "1px solid #b8860b", padding: "0.75rem" }}>
          <p style={{ margin: "0 0 0.5rem" }}>
            Er bestaat al een actieve patiënt met dit BSN. Een dubbele registratie wordt niet
            opgeslagen.
          </p>
          {duplicate.canOverride ? (
            <button type="button" disabled={submitting} onClick={() => void submit(true)}>
              Toch opslaan (beheerder bevestigt het duplicaat)
            </button>
          ) : (
            <p style={{ margin: 0 }}>
              Alleen een beheerder kan een duplicaat bevestigen en alsnog opslaan.
            </p>
          )}
        </div>
      )}

      {formError !== null && (
        <p role="alert" style={{ color: "#b00020", margin: 0 }}>
          {formError}
        </p>
      )}

      <button type="submit" disabled={submitting}>
        {submitting ? "Bezig met opslaan…" : "Patiënt aanmaken"}
      </button>
    </form>
  );
}

/**
 * A labelled form row with an optional inline error message. The label is
 * explicitly associated with its control via `htmlFor` (matching the control's
 * `id`), so the association is accessible and statically verifiable.
 */
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
