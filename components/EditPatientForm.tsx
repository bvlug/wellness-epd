"use client";

import type { PatientProfileView, PatientUpdateErrorData } from "@/convex/patients";
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
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PatientFormField as Field } from "./PatientFormField";

/**
 * "Patiënt bewerken" form (Story P-1-S3; FR-2). A client component that loads an
 * existing patient, prefills the editable fields, runs the SHARED
 * {@link validatePatientInput} for instant client-side feedback, and calls the
 * Convex `updatePatient` mutation — which re-validates, authorizes (balie/admin,
 * AC-2), and re-checks the BSN duplicate gate server-side (the form's checks are
 * convenience only; the server is the authority). On success it returns to the
 * patient's profile page showing the new values.
 *
 * It reuses the create form's {@link Field} (inline-error) pattern and the same
 * validation, exactly as P-1-S3 requires. Domain terms and user-facing copy stay
 * Dutch (project convention).
 *
 * AVG/GDPR (BR-11): the BSN value is never written to the console or echoed in an
 * error message — field errors reference the field, not the value.
 *
 * **Loading the current values.** We reuse the profile view path
 * (`patients:getPatientForView`) to fetch the record; it is the authorized read
 * for a patient and already returns every editable field. Note it also writes a
 * `view` audit entry — opening the edit form is a legitimate view of the record,
 * so this is acceptable; the subsequent save writes its own `edit` entry (AC-9).
 */

/**
 * Offline-safe references to the Convex functions, named by their `"file:export"`
 * path (the generated `api` object is gitignored — codebase pattern). The view
 * mutation loads the current values; the update mutation persists the edit.
 */
const getPatientForViewRef = makeFunctionReference<
  "mutation",
  { patientId: string },
  PatientProfileView
>("patients:getPatientForView");

const updatePatientRef = makeFunctionReference<
  "mutation",
  {
    patientId: string;
    voornaam?: string;
    tussenvoegsel?: string;
    achternaam?: string;
    geboortedatum?: string;
    geslacht?: (typeof GESLACHT_VALUES)[number];
    bsn?: string;
    email?: string;
    telefoonnummer?: string;
    notities?: string;
    acknowledgeDuplicate?: boolean;
  },
  { patientId: string }
>("patients:updatePatient");

type FieldErrors = Partial<Record<PatientField, string>>;

const GESLACHT_LABELS: Record<(typeof GESLACHT_VALUES)[number], string> = {
  man: "Man",
  vrouw: "Vrouw",
  overig: "Overig",
  onbekend: "Onbekend",
};

/** Map the loaded patient record into the editable form shape. */
function toForm(patient: PatientProfileView["patient"]): PatientInput {
  return {
    voornaam: patient.voornaam,
    tussenvoegsel: patient.tussenvoegsel ?? "",
    achternaam: patient.achternaam,
    geboortedatum: patient.geboortedatum,
    geslacht: patient.geslacht,
    bsn: patient.bsn,
    email: patient.email ?? "",
    telefoonnummer: patient.telefoonnummer ?? "",
    notities: patient.notities ?? "",
  };
}

/** Narrow an unknown thrown value to the structured update-error payload. */
function asUpdateError(error: unknown): PatientUpdateErrorData | null {
  if (error instanceof ConvexError) {
    const { data } = error;
    if (data && typeof data === "object" && "code" in data) {
      return data as PatientUpdateErrorData;
    }
  }
  return null;
}

type LoadState =
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "not_found" }
  | { status: "error" };

export function EditPatientForm({ patientId }: { patientId: string }) {
  const router = useRouter();
  const getPatientForView = useMutation(getPatientForViewRef);
  const updatePatient = useMutation(updatePatientRef);

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [form, setForm] = useState<PatientInput | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ canOverride: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load the current values exactly once per patient (Strict Mode fires effects
  // twice in dev; the ref keeps us to a single load, mirroring PatientProfile).
  const loadedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (loadedForRef.current === patientId) {
      return;
    }
    loadedForRef.current = patientId;
    setState({ status: "loading" });
    void (async () => {
      try {
        const data = await getPatientForView({ patientId });
        setForm(toForm(data.patient));
        setState({ status: "loaded" });
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

  function update<K extends keyof PatientInput>(key: K, value: PatientInput[K]) {
    setForm((prev) => (prev === null ? prev : { ...prev, [key]: value }));
  }

  function collectFieldErrors(input: PatientInput): FieldErrors {
    const errors: FieldErrors = {};
    for (const error of validatePatientInput(input)) {
      errors[error.field] ??= error.message;
    }
    return errors;
  }

  async function submit(acknowledgeDuplicate: boolean) {
    if (form === null) {
      return;
    }
    setFormError(null);

    const clientErrors = collectFieldErrors(form);
    if (Object.keys(clientErrors).length > 0) {
      setFieldErrors(clientErrors);
      return;
    }
    setFieldErrors({});

    setSubmitting(true);
    try {
      // Send the full editable set; the server merges it as a partial update and
      // re-validates. Optional contact fields are sent as undefined when blank so
      // a cleared field is persisted as "removed" rather than an empty string.
      await updatePatient({
        patientId,
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
      router.push(PATIENT_ROUTES.profile(patientId));
    } catch (error) {
      const data = asUpdateError(error);
      if (data?.code === "validation_failed") {
        const errors: FieldErrors = {};
        for (const e of data.errors) {
          errors[e.field] ??= e.message;
        }
        setFieldErrors(errors);
      } else if (data?.code === "duplicate_bsn") {
        setDuplicate({ canOverride: data.canOverride });
      } else if (data?.code === "patient_not_found") {
        setFormError("Deze patiënt bestaat niet (meer).");
      } else {
        setFormError("Opslaan is mislukt. Probeer het opnieuw.");
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

  if (state.status === "loading") {
    return <p>Gegevens laden…</p>;
  }

  if (state.status === "not_found") {
    return (
      <div role="alert">
        <p>Deze patiënt bestaat niet (meer).</p>
      </div>
    );
  }

  if (state.status === "error" || form === null) {
    return (
      <p role="alert" style={{ color: "#b00020" }}>
        De gegevens konden niet worden geladen. Probeer het opnieuw.
      </p>
    );
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
            Er bestaat al een andere actieve patiënt met dit BSN. De wijziging wordt niet
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
        {submitting ? "Bezig met opslaan…" : "Wijzigingen opslaan"}
      </button>
    </form>
  );
}
