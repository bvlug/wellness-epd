import { PatientSearch } from "@/components/PatientSearch";

/**
 * "Patiënt zoeken" page (Story P-2-S1; FR-4). Protected by the Clerk
 * middleware, so reaching it implies an authenticated session; the Convex
 * `searchPatients` query additionally authorizes the caller server-side. The
 * search form and results list live in a client component.
 */
export default function SearchPatientsPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginTop: 0 }}>Patiënt zoeken</h1>
      <p>Zoek op achternaam, voornaam, geboortedatum of BSN.</p>
      <PatientSearch />
    </main>
  );
}
