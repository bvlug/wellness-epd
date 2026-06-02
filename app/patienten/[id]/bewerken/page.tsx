import { EditPatientForm } from "@/components/EditPatientForm";

/**
 * "Patiënt bewerken" page (Story P-1-S3; FR-2). Protected by the Clerk
 * middleware, so reaching it implies an authenticated session; the Convex
 * `updatePatient` mutation additionally authorizes the caller's role
 * (balie/admin) server-side (AC-2). The form (a client component) loads the
 * current values, validates, and persists the edit.
 *
 * In Next.js 15 the App Router passes route params as a Promise.
 */
export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Patiënt bewerken</h1>
      <p>Velden met * zijn verplicht.</p>
      <EditPatientForm patientId={id} />
    </main>
  );
}
