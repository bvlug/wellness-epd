/**
 * Patiëntprofiel — PLACEHOLDER (Story P-1-S1 redirect target).
 *
 * The successful-creation flow (P-1-S1) redirects here, but the real profile
 * view is Story #20 (P-1-S2, "View patient profile"), which is not built yet.
 * This page exists only so the create redirect has a stable, route-correct
 * destination today; #20 will replace this body with the authorized Convex
 * `getPatient` query and the full profile UI.
 *
 * DELIBERATELY shows NO patient data: it does not (yet) fetch the record, so no
 * patient-identifying data is rendered here (AVG/GDPR). It only echoes the
 * opaque Convex id from the route — a system identifier, not PII.
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
      <p>
        De patiënt is aangemaakt. Het volledige profiel wordt in een volgende story (#20)
        toegevoegd.
      </p>
      <p style={{ color: "#555", fontSize: "0.875rem" }}>Record-id: {id}</p>
    </main>
  );
}
