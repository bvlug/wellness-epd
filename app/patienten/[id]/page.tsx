import { PatientProfile } from "@/components/PatientProfile";

/**
 * Patiëntprofiel — read-only patient profile view (Story P-1-S2; FR-3, AC-1,
 * AC-9). Protected by the Clerk middleware, so reaching it implies an
 * authenticated session; the Convex `getPatientForView` path additionally
 * authorizes the identity server-side and writes the `view` audit entry (AC-9).
 *
 * The actual data fetch + audit-on-view happens in the {@link PatientProfile}
 * client component, because the view path is a Convex mutation (a query is
 * read-only and cannot write the audit entry — AC-7). This page only resolves
 * the route id and hands it down.
 *
 * In Next.js 15 the App Router passes route params as a Promise.
 */
export default async function PatientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Patiëntprofiel</h1>
      <PatientProfile patientId={id} />
    </main>
  );
}
