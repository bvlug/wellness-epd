import { NewPatientForm } from "@/components/NewPatientForm";

/**
 * "Nieuwe patiënt" page (Story P-1-S1). Protected by the Clerk middleware, so
 * reaching it implies an authenticated session; the Convex `createPatient`
 * mutation additionally authorizes the caller's role (balie/admin) server-side
 * (AC-2). The form itself lives in a client component.
 */
export default function NewPatientPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Nieuwe patiënt</h1>
      <p>Velden met * zijn verplicht.</p>
      <NewPatientForm />
    </main>
  );
}
