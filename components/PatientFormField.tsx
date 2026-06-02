import type { ReactNode } from "react";

/**
 * A labelled form row with an optional inline error message, shared by the
 * patient create ({@link import("./NewPatientForm").NewPatientForm}) and edit
 * ({@link import("./EditPatientForm").EditPatientForm}) forms so both render the
 * SAME field/inline-error pattern (Story P-1-S3 reuses P-1-S1's UI).
 *
 * The label is explicitly associated with its control via `htmlFor` (matching
 * the control's `id`), so the association is accessible and statically
 * verifiable. An error is announced via `role="alert"`.
 */
export function PatientFormField({
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
