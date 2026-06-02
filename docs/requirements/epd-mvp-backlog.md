# EPD MVP — Agile Backlog

> **Version:** 1.0
> **Date:** 2026-06-02
> **Status:** Draft — pending product owner review before GitHub Issues creation
> **Source:** FRD v0.4-draft (`epd-mvp-frd.md`)
> **Language policy:** Internal artifact — written in English. Dutch domain terms (`patient`,
> `afspraak`, `behandeling`, `behandelaar`, `balie`) are kept as the ubiquitous language.

---

## How to read this document

Each section covers one domain. Within a domain there are one or more **epics**, each with
child **user stories**. Stories carry:

- A `FR-N` trace to the FRD requirement(s) they implement.
- Gherkin acceptance criteria (Given/When/Then) for the happy path and key edge cases.
- A Fibonacci size estimate (1 / 2 / 3 / 5 / 8 / 13). Stories estimated 8+ are flagged for
  splitting before sprint planning.
- Dependency notes (other stories that must be done first).
- GitHub Issues metadata: suggested title, type label (`epic` or `story`), and domain label.

The **Build Order** section at the end sequences everything from foundation to feature.

---

## Domain 0 — Foundation (Cross-cutting)

This domain has no FRD section of its own but is implied by every other domain. It covers the
scaffolding, authentication wiring, role model, Convex schema, and the audit-trail mechanism
that all other domains depend on. It must be built first.

---

### Epic F-1 — Project Scaffold & Infrastructure

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:foundation`, `epic`

**Goal / Business Value**
Establish the runnable project skeleton (Next.js + Convex + Clerk + Biome + Vitest) so that
every downstream team can build on a stable, consistent foundation without re-solving
integration problems.

**Scope**
- In scope: repository initialization, dependency installation, Clerk + Convex integration,
  environment variable wiring (local + CI), Biome config, Vitest config, deployment pipeline
  stubs (Vercel + Convex Cloud), basic sign-in / sign-out flow.
- Out of scope: any domain-specific screens, data model tables other than schema bootstrapping,
  feature flags.

**Success Metrics**
- `pnpm dev` and `npx convex dev` start without errors.
- A Clerk-authenticated user can sign in and reach a placeholder home page.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` all pass on a clean checkout.

**Child Stories**
F-1-S1, F-1-S2

---

#### Story F-1-S1 — Project scaffold and local development setup

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-1

As a developer, I want the project scaffolded with Next.js, Convex, Clerk, Biome, and Vitest
so that I can start building features on a consistent, runnable baseline.

**FRD trace:** Implied by architecture section of CLAUDE.md; no explicit FR-N.

**Acceptance Criteria**

```gherkin
Scenario: Local development stack starts
  Given the repository has been cloned and `pnpm install` has run
  When the developer runs `pnpm dev` and `npx convex dev` side by side
  Then both processes start without errors
  And the Next.js app is reachable at localhost:3000

Scenario: Linting and type-checking pass on clean checkout
  Given the repository has been cloned and `pnpm install` has run
  When the developer runs `pnpm lint` and `pnpm typecheck`
  Then both commands exit with code 0 and report no violations

Scenario: Test runner executes successfully
  Given the repository has been cloned and `pnpm install` has run
  When the developer runs `pnpm test`
  Then Vitest exits with code 0 (no failing tests; placeholder test present)
```

**Size:** 3
**Dependencies:** None — this is the first story.
**Assumptions:** pnpm, Node.js LTS, and Convex CLI are available in the developer environment.

---

#### Story F-1-S2 — Clerk authentication integration and session management

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-1

As a clinic staff member, I want to sign in with my Clerk account and have my session
recognized by the Convex backend so that I can access the EPD application securely.

**FRD trace:** AC-1, EH-6, EH-7; Actors / Roles section (Clerk as identity provider).

**Acceptance Criteria**

```gherkin
Scenario: Successful sign-in
  Given I am an unauthenticated user navigating to any EPD page
  When I complete the Clerk sign-in flow
  Then I am redirected to the EPD home page
  And subsequent Convex queries include a valid Clerk JWT

Scenario: Unauthenticated access is blocked
  Given I am not signed in
  When I navigate directly to a protected EPD page
  Then I am redirected to the Clerk sign-in page
  And no patient data is returned by any Convex function (AC-1)

Scenario: Session expiry redirect
  Given I am signed in and my Clerk session has expired mid-flow
  When the Next.js app detects the expired session
  Then I am redirected to the sign-in page
  And after re-authentication I am returned to the page I was on (EH-6, A-26)

Scenario: Unauthorized Convex call
  Given a request arrives at a Convex function without a valid Clerk identity token
  When the function checks `ctx.auth.getUserIdentity()`
  Then it returns a Convex auth error without exposing any data (EH-7)
```

**Size:** 3
**Dependencies:** F-1-S1 (scaffold must exist).
**Notes:** Return-URL preservation (EH-6) requires Next.js middleware or Clerk's built-in
redirect handling — verify against Clerk SDK version in use.

---

### Epic F-2 — Role Model & Authorization Layer

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:foundation`, `epic`

**Goal / Business Value**
Establish the three-role model (`admin`, `behandelaar`, `balie`) in Clerk and make role
membership readable by Convex functions, so that every subsequent feature can enforce
authorization from the start rather than bolting it on afterward.

**Scope**
- In scope: Clerk public metadata role storage, a reusable Convex authorization helper that
  reads roles from the JWT claim, enforcement of the role-permission matrix, the additive
  multi-role rule, and a smoke test confirming that a balie caller is denied a
  behandeling-create mutation.
- Out of scope: admin UI for managing user/role assignments (that is in Epic F-3), any domain
  feature screens.

**Success Metrics**
- A Convex helper function `assertHasRole(ctx, [...roles])` exists and is used in all
  mutations/queries that touch patient data.
- A balie user calling a behandeling-create mutation receives a permission-denied error (AC-2).
- A user holding both `behandelaar` and `balie` roles can exercise permissions of both (A-2).

**Child Stories**
F-2-S1

---

#### Story F-2-S1 — Convex role-authorization helper and enforcement baseline

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-2

As a system, I want every Convex function that touches patient data to enforce role-based
access using the caller's Clerk roles so that unauthorized callers are rejected at the backend
regardless of UI state.

**FRD trace:** AC-2, AC-1, A-2; role-permission matrix (Actors / Roles section).

**Acceptance Criteria**

```gherkin
Scenario: Authorized role passes the check
  Given a Convex function is annotated to require the `balie` role
  And the caller's Clerk JWT contains the `balie` role claim
  When the function executes
  Then it proceeds past the authorization check without error

Scenario: Unauthorized role is rejected
  Given a Convex function is annotated to require the `behandelaar` role
  And the caller's Clerk JWT contains only the `balie` role claim
  When the function executes
  Then it throws a permission-denied ConvexError before touching any data

Scenario: Additive multi-role user passes union check
  Given a caller holds both `behandelaar` and `balie` roles
  And a function requires the `behandelaar` role
  When the function executes
  Then it proceeds, because the union of held roles satisfies the requirement (A-2)

Scenario: Unauthenticated caller is rejected
  Given no valid Clerk JWT is present in the request
  When any authorized Convex function is called
  Then it returns an auth error before executing any logic (AC-1)
```

**Size:** 3
**Dependencies:** F-1-S2 (Clerk integration must be complete).
**Notes:** Implement as a shared `lib/auth.ts` helper inside `convex/`. All domain stories
depend on this story being done.

---

### Epic F-3 — Convex Schema Bootstrap & Admin User Management

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:foundation`, `epic`

**Goal / Business Value**
Define the full Convex schema (`convex/schema.ts`) and provide an admin screen for managing
Clerk user roles, so that the data model is the single source of truth from day one and an
admin can grant/revoke roles without direct Clerk dashboard access.

**Scope**
- In scope: `convex/schema.ts` with all five collections (`patient`, `afspraak`, `behandeling`,
  `behandelsoort`, `audit_log`); admin UI for listing Clerk users and assigning/removing roles;
  basic seed script with anonymized test data.
- Out of scope: domain-specific CRUD operations (those belong to domain epics).

**Success Metrics**
- `npx convex dev` applies the schema without errors.
- An admin can open the user-management screen, see the list of Clerk users, and assign a role.
- The Convex dashboard shows all five collections after schema deploy.

**Child Stories**
F-3-S1, F-3-S2

---

#### Story F-3-S1 — Full Convex schema definition

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-3

As a developer, I want the complete Convex schema defined in `convex/schema.ts` so that all
collections, field types, and constraints are established as the single source of truth before
any domain feature is built.

**FRD trace:** Data Requirements section (all five collections); BR-8, BR-12, BR-13.

**Acceptance Criteria**

```gherkin
Scenario: Schema deploys cleanly
  Given `convex/schema.ts` defines patient, afspraak, behandeling, behandelsoort, and audit_log
  When the developer runs `npx convex dev`
  Then Convex applies the schema without errors
  And all five collections are visible in the Convex dashboard

Scenario: Required fields are declared non-nullable
  Given the schema is deployed
  When a mutation attempts to insert a patient document without the `bsn` field
  Then Convex rejects the write with a validation error

Scenario: Audit log collection has no update or delete mutation
  Given the schema and initial Convex functions are deployed
  When a developer searches `convex/` for any mutation that targets `audit_log`
  Then only append (insert) operations exist — no update or delete mutations (BR-13)
```

**Size:** 3
**Dependencies:** F-1-S1 (scaffold), F-2-S1 (auth helper, so schema design accounts for role checks).
**Notes:** Schema must use Convex `v.*` validators throughout; no raw TypeScript types.

---

#### Story F-3-S2 — Admin user and role management screen

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-3

As an admin, I want a user management screen where I can view all Clerk users and assign or
remove the `admin`, `behandelaar`, and `balie` roles so that I can control who has access to
the EPD without needing direct access to the Clerk dashboard.

**FRD trace:** Role-permission matrix (admin row: "Manage users / roles").

**Acceptance Criteria**

```gherkin
Scenario: Admin views user list
  Given I am signed in as admin
  When I navigate to the user management screen
  Then I see a list of all Clerk users with their current role(s)

Scenario: Admin assigns a role
  Given I am signed in as admin and I see a user with no EPD roles
  When I select the `behandelaar` role for that user and confirm
  Then the user's Clerk public metadata is updated with the `behandelaar` role
  And the change takes effect on the user's next Convex call

Scenario: Admin removes a role
  Given I am signed in as admin and I see a user with the `balie` role
  When I remove the `balie` role for that user and confirm
  Then the user's Clerk public metadata no longer contains `balie`

Scenario: Non-admin is denied access
  Given I am signed in with only the `balie` role
  When I attempt to navigate to the user management screen
  Then I see an access-denied message and cannot see any user data
```

**Size:** 5
**Dependencies:** F-1-S2, F-2-S1, F-3-S1.
**Notes:** Requires a Convex Action (not mutation) to call the Clerk Management API server-side.
Clerk API key must be stored as a Convex environment secret, not in the frontend.

---

### Epic F-4 — Audit Trail Infrastructure

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:foundation`, `epic`

**Goal / Business Value**
Implement the append-only `audit_log` write mechanism as a reusable Convex utility, so that
every domain mutation can include a compliant audit entry with a single helper call, satisfying
AVG Art. 5(2) and Art. 30 accountability from the first feature shipped.

**Scope**
- In scope: a `writeAuditLog(ctx, entry)` helper that inserts an `audit_log` document;
  validation that the entry payload contains no patient-identifying data (no names, BSNs, or
  clinical text — only system IDs); unit tests for the helper with anonymized data.
- Out of scope: audit log UI (explicitly out of MVP per FRD); querying/reporting on audit log
  entries.

**Success Metrics**
- Every Convex function that creates, edits, reads, deactivates, or finalizes a `patient` or
  `behandeling` record produces an `audit_log` entry (AC-9, BR-13).
- An audit entry payload inspection test confirms no patient name, BSN, email, address, or
  `behandelverslag` text appears in any entry field (AC-9, AC-7).

**Child Stories**
F-4-S1

---

#### Story F-4-S1 — Audit log write helper and no-PII validation

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:foundation`, `story`
- Parent epic: Epic F-4

As a system, I want a reusable Convex helper that writes an append-only `audit_log` entry so
that every authorized mutation automatically produces a compliant, PII-free accountability
record.

**FRD trace:** FR-20, BR-13, AC-7, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Audit entry is written on patient create
  Given a Convex mutation creates a patient record
  When the mutation completes successfully
  Then exactly one audit_log entry exists with action=create, resourceType=patient,
       and the correct patientId as resourceId
  And the entry contains no patient name, BSN, email, address, or clinical text (AC-9)

Scenario: Audit entry is written on patient view
  Given a Convex query returns a patient record to an authenticated user
  When the query completes
  Then exactly one audit_log entry exists with action=view, resourceType=patient,
       and the correct patientId as resourceId

Scenario: Parent operation fails if audit write fails
  Given the audit_log collection is intentionally unavailable (simulated)
  When a Convex mutation that requires an audit entry runs
  Then the entire mutation is rolled back (the primary record is also not written) (BR-13)

Scenario: Audit entry contains no PII
  Given any audit_log entry written by the system
  When a test inspects all fields of the entry
  Then none of actorId, actorRole, action, resourceType, resourceId, timestamp
       contain a display name, BSN value, email address, phone number, postal address,
       or behandelverslag fragment

Scenario: Audit_log is append-only
  Given an existing audit_log entry
  When a developer attempts to call a Convex mutation that updates or deletes that entry
  Then no such mutation exists in the codebase (static check) (BR-13)
```

**Size:** 3
**Dependencies:** F-3-S1 (schema must define `audit_log` collection), F-2-S1 (auth helper).
**Notes:** All domain stories that write or read patient or behandeling data depend on this
story being done before they can satisfy AC-9.

---

## Domain 1 — Patiëntbeheer (Patient Management)

This domain covers creating, viewing, editing, searching, and deactivating patient records.
It depends on Domain 0 (Foundation) being complete.

---

### Epic P-1 — Patient Record CRUD

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:patientbeheer`, `epic`

**Goal / Business Value**
Give reception staff (balie) a single, authoritative place to register and maintain patient
profiles so that patient data is no longer managed in paper or ad-hoc spreadsheets.

**Scope**
- In scope: create, view, and edit patient records with all FR-1/FR-2/FR-3 fields; BSN
  validation (Elfproef); geslacht controlled vocabulary; duplicate-BSN warning; deactivation
  (FR-5).
- Out of scope: patient login, file attachments, GP reference, hard deletion (GDPR Art. 17),
  migration of existing records.

**Success Metrics**
- A balie user can create a complete patient record in one form submission.
- A BSN with an invalid Elfproef is rejected before saving.
- A behandelaar can open a patient profile and see all fields, upcoming afspraken summary, and
  last five behandelingen.

**Child Stories**
P-1-S1, P-1-S2, P-1-S3, P-1-S4

---

#### Story P-1-S1 — Create patient record

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:patientbeheer`, `story`
- Parent epic: Epic P-1

As a balie user, I want to create a new patient record with all required and optional fields
so that the patient is registered as a single, authoritative profile in the EPD.

**FRD trace:** FR-1, BR-1, BR-2, BR-3, BR-11, EH-4, AC-2.

**Acceptance Criteria**

```gherkin
Scenario: Successful patient creation
  Given I am signed in as balie
  And I navigate to "New patient"
  When I fill in all required fields (voornaam, achternaam, geboortedatum, geslacht, BSN)
       with valid values and submit
  Then a patient record is created in Convex
  And I am redirected to the new patient's profile page
  And an audit_log entry with action=create, resourceType=patient is written (AC-9)

Scenario: Invalid BSN is rejected
  Given I am on the new patient form
  When I enter a BSN that does not pass the Elfproef algorithm and submit
  Then the form displays a validation error on the BSN field
  And no record is created in Convex (BR-2)

Scenario: Missing required field is rejected
  Given I am on the new patient form
  When I submit without entering a geboortedatum
  Then the form displays a required-field error
  And no record is created in Convex

Scenario: Geslacht only accepts controlled values
  Given I am on the new patient form
  When I attempt to submit with a geslacht value outside man/vrouw/overig/onbekend
  Then the form rejects the input with a validation error (BR-1)

Scenario: Duplicate BSN triggers warning
  Given an active patient with BSN "123456782" already exists
  When I submit a new patient form with BSN "123456782"
  Then a duplicate-BSN warning is shown
  And the record is not saved until an admin explicitly acknowledges the duplicate (EH-4, A-25)

Scenario: Geboortedatum must be in the past
  Given I am on the new patient form
  When I enter a geboortedatum that is today or in the future
  Then a validation error is shown
  And no record is created

Scenario: balie role cannot be denied by frontend bypass
  Given a caller with only the `admin` role calls the patient-create Convex mutation directly
  Then the mutation succeeds (admin is also permitted per FR-1)
  Given a caller with only the `behandelaar` role calls the patient-create mutation directly
  Then the mutation returns a permission-denied error (AC-2)
```

**Size:** 5
**Dependencies:** F-3-S1 (schema), F-2-S1 (auth), F-4-S1 (audit log).
**Notes:** BSN must never appear in Convex function logs or error messages (BR-11). The Elfproef
algorithm should be implemented as a pure TypeScript utility, independently testable.

---

#### Story P-1-S2 — View patient profile

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:patientbeheer`, `story`
- Parent epic: Epic P-1

As any authenticated clinic staff member, I want to view a read-only patient profile page that
shows all patient fields, upcoming afspraken, and a summary of recent behandelingen so that I
have a complete picture of the patient before a consultation or scheduling interaction.

**FRD trace:** FR-3, AC-1, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Authenticated user views patient profile
  Given I am signed in as behandelaar (or balie or admin)
  When I navigate to an existing patient's profile page
  Then I see all fields from FR-1 including the full BSN (BR-3)
  And an audit_log entry with action=view, resourceType=patient is written (AC-9)

Scenario: Profile shows upcoming afspraken summary
  Given the patient has two future afspraken
  When I view their profile
  Then I see those two afspraken listed in the upcoming section

Scenario: Profile shows last five behandelingen
  Given the patient has seven behandelingen records
  When I view their profile
  Then I see the five most recent behandelingen with a "view full history" link

Scenario: Unauthenticated access is blocked
  Given I am not signed in
  When I navigate directly to a patient profile URL
  Then I am redirected to sign-in (AC-1)
  And no patient data is returned by the Convex query
```

**Size:** 3
**Dependencies:** P-1-S1 (patient record must exist), F-4-S1 (audit).
**Notes:** The upcoming afspraken and behandelingen summaries on this page require Afspraken
and Behandelingen domain epics to be deliverable in full; a stub/empty state is acceptable
in Sprint 1.

---

#### Story P-1-S3 — Edit patient record

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:patientbeheer`, `story`
- Parent epic: Epic P-1

As a balie user, I want to edit an existing patient's details from their profile page so that
the patient record stays accurate as their information changes over time.

**FRD trace:** FR-2, BR-2, BR-1, EH-2, EH-4, AC-2, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Successful field edit
  Given I am signed in as balie
  And I am on a patient's profile page
  When I click edit, change the telefoonnummer, and save
  Then the patient record is updated in Convex
  And an audit_log entry with action=edit, resourceType=patient is written (AC-9)
  And I am returned to the patient profile page showing the new value

Scenario: Partial update only changes submitted fields
  Given I edit only the email address
  When I save
  Then only the email field is updated; all other fields remain unchanged (A-9)

Scenario: Editing BSN validates Elfproef
  Given I change the BSN to an invalid value
  When I save
  Then the form shows a BSN validation error and the record is not updated (BR-2)

Scenario: behandelaar cannot edit patient
  Given I am signed in as behandelaar only
  When I attempt to call the patient-edit Convex mutation directly
  Then I receive a permission-denied error (AC-2)

Scenario: Duplicate BSN on edit triggers warning
  Given another active patient has BSN "123456782"
  When I edit a different patient's BSN to "123456782" and save
  Then a duplicate-BSN warning is shown and the save is blocked pending admin acknowledgment (EH-4)
```

**Size:** 3
**Dependencies:** P-1-S1, P-1-S2, F-4-S1.

---

#### Story P-1-S4 — Deactivate patient record

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:patientbeheer`, `story`
- Parent epic: Epic P-1

As an admin, I want to deactivate a patient record so that inactive patients no longer appear
in daily workflows while their historical data is preserved for audit purposes.

**FRD trace:** FR-5, A-11, AC-3, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Admin deactivates a patient
  Given I am signed in as admin
  And I am on an active patient's profile page
  When I click "Deactivate patient" and confirm
  Then the patient's `actief` flag is set to false in Convex
  And an audit_log entry with action=deactivate, resourceType=patient is written (AC-9)

Scenario: Deactivated patient does not appear in default search
  Given a patient has been deactivated
  When any user performs a patient search by name or BSN
  Then the deactivated patient is not included in results (AC-3)

Scenario: Admin can find deactivated patient with include-inactive filter
  Given a patient has been deactivated
  When an admin performs a search with the "include inactive" filter enabled
  Then the deactivated patient appears in results, clearly marked as inactive

Scenario: Deactivated patient cannot be assigned to new afspraken
  Given a patient has been deactivated
  When a balie user creates a new afspraak
  And selects the patient from the lookup
  Then the deactivated patient does not appear in the patient selection list (FR-5)

Scenario: Non-admin cannot deactivate
  Given I am signed in as balie
  When I attempt to call the patient-deactivate Convex mutation directly
  Then I receive a permission-denied error
```

**Size:** 3
**Dependencies:** P-1-S1, P-1-S2, F-4-S1.

---

### Epic P-2 — Patient Search

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:patientbeheer`, `epic`

**Goal / Business Value**
Enable all clinic staff to find a specific patient quickly by name, date of birth, or BSN,
reducing time spent on administrative lookup and eliminating the risk of accidentally returning
bulk patient data.

**Scope**
- In scope: name search (full/partial), date-of-birth search, BSN exact search, 50-record cap,
  no-input guard, search results list.
- Out of scope: full-text search across clinical notes, phonetic matching, pagination beyond
  the 50-cap.

**Success Metrics**
- A user can find a patient by BSN in one search action.
- An empty search returns zero results with a "please enter search criteria" message.
- Search results display last name, first name, date of birth, and patient ID.

**Child Stories**
P-2-S1

---

#### Story P-2-S1 — Search patients by name, date of birth, or BSN

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:patientbeheer`, `story`
- Parent epic: Epic P-2

As a clinic staff member, I want to search for patients by name, date of birth, or BSN so
that I can quickly navigate to the right patient record without scrolling through a full list.

**FRD trace:** FR-4, BR-4, EH-1, A-10, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Search by partial last name returns matching patients
  Given there are three active patients with achternaam starting with "Jansen"
  When I search for "Jan"
  Then I see all three matching patients in the results list
  And each result shows last name, first name, geboortedatum, and patientId

Scenario: Search by exact BSN returns one patient
  Given an active patient has BSN "123456782"
  When I search by BSN "123456782"
  Then exactly that one patient is returned

Scenario: Empty search returns no results
  Given I am on the search screen
  When I submit the search form with no criteria entered
  Then I see the message "please enter search criteria"
  And zero results are returned (BR-4)

Scenario: Search caps results at 50
  Given there are 80 active patients whose name starts with "De"
  When I search for "De"
  Then at most 50 results are returned (A-10)

Scenario: BSN search on deactivated patient returns no results
  Given a patient with BSN "987654321" has been deactivated
  When I search by that BSN without the include-inactive filter
  Then zero results are returned (EH-1)
  And no indication is given that the BSN exists on an inactive record

Scenario: Search on patient view generates audit entry
  Given I perform a patient search that returns results
  When I click through to a patient profile
  Then an audit_log entry with action=view is written for the opened patient (AC-9)
```

**Size:** 5
**Dependencies:** P-1-S1, F-4-S1, F-2-S1.
**Notes:** The Convex query must not return all patients when no filter is active (BR-4).
BSN must not appear in Convex log output even when used as a search key (BR-11).

---

## Domain 2 — Afspraken / Agenda (Appointments / Calendar)

This domain depends on Domain 0 (Foundation) and on Epic P-1 (patients must exist) and
Epic P-2 (patient search used in afspraak creation). It also requires the behandelsoort
vocabulary (Epic B-3) to be seeded or manageable before afspraken can reference it.

---

### Epic A-1 — Afspraak Lifecycle Management

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:afspraken`, `epic`

**Goal / Business Value**
Enable reception staff (balie) to schedule, reschedule, and cancel appointments with
behandelaars so that the clinic's calendar is accurate and both staff and patients can rely
on it as the source of truth for scheduled sessions.

**Scope**
- In scope: create afspraak (FR-6), edit afspraak (FR-7), cancel afspraak (FR-8), mark as
  voltooid (FR-10), status lifecycle enforcement (FR-11), conflict detection / soft warning
  (FR-12).
- Out of scope: email/SMS notifications, external calendar sync, recurring appointments,
  group sessions.

**Success Metrics**
- A balie user can schedule an afspraak end-to-end and see it immediately in the agenda.
- All invalid status transitions are rejected by the Convex mutation (AC-4).
- A conflict warning is shown when a new afspraak overlaps an existing one (AC-8).

**Child Stories**
A-1-S1, A-1-S2, A-1-S3, A-1-S4

---

#### Story A-1-S1 — Create afspraak

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-1

As a balie user, I want to schedule an afspraak for a patient with a behandelaar so that the
appointment is registered and immediately visible in the agenda.

**FRD trace:** FR-6, FR-12, BR-5, BR-7, BR-12, AC-2, AC-8, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Successful afspraak creation
  Given I am signed in as balie
  And I select an active patient, an active behandelaar, a future date/time, and a duration
  When I submit the form
  Then an afspraak record with status=gepland is created in Convex
  And an audit_log entry with action=create, resourceType=afspraak is written
  And the afspraak appears immediately in the agenda view (reactive via Convex)

Scenario: Past date/time is rejected
  Given I select a date/time that is in the past
  When I submit
  Then a validation error is shown and no record is created (BR-5)

Scenario: Deactivated behandelaar does not appear in selection
  Given a behandelaar account has been deactivated or had their role removed
  When I open the behandelaar dropdown
  Then that behandelaar does not appear in the list (BR-7)

Scenario: behandelsoort is optional but if selected must be active
  Given I select a behandelsoort that has been deactivated
  When I submit
  Then a validation error is shown: the behandelsoort must be active (BR-12)

Scenario: Conflict warning shown for overlapping appointment
  Given behandelaar "X" has an existing gepland afspraak from 10:00 to 10:30
  When I create a new afspraak for behandelaar "X" starting at 10:15
  Then a visible conflict warning is displayed before I can confirm save (AC-8, FR-12)
  And I can still choose to save despite the warning (soft block, A-17)

Scenario: behandelaar role cannot create afspraken
  Given I am signed in as behandelaar only
  When I attempt to call the afspraak-create Convex mutation directly
  Then I receive a permission-denied error (AC-2)
```

**Size:** 5
**Dependencies:** P-1-S1, P-2-S1, F-2-S1, F-4-S1, B-3-S1 (behandelsoort vocabulary must
exist to be referenced).
**Notes:** Default duration is 30 minutes (A-12). The conflict check compares against all
`gepland` and `bevestigd` afspraken for the same behandelaarId (FR-12).

---

#### Story A-1-S2 — Edit and reschedule afspraak

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-1

As a balie user, I want to edit the date/time, duration, behandelsoort, and notes of a
scheduled afspraak so that I can correct or update the appointment without cancelling and
recreating it.

**FRD trace:** FR-7, FR-12, BR-5, AC-4, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Successful edit of a gepland afspraak
  Given an afspraak has status=gepland
  When I update the start time to a future time and save
  Then the afspraak record is updated in Convex
  And an audit_log entry with action=edit, resourceType=afspraak is written

Scenario: Editing a voltooid afspraak is blocked
  Given an afspraak has status=voltooid
  When I attempt to edit it
  Then the edit option is not available in the UI
  And the Convex mutation rejects the request with an appropriate error (FR-7, AC-4)

Scenario: Rescheduling triggers conflict check
  Given rescheduling creates an overlap with another afspraak for the same behandelaar
  When I save the updated time
  Then a conflict warning is shown before confirmation (FR-12, AC-8)

Scenario: Past date is rejected on reschedule
  Given I reschedule an afspraak to a date/time in the past
  When I save
  Then a validation error is shown (BR-5)
```

**Size:** 3
**Dependencies:** A-1-S1.

---

#### Story A-1-S3 — Cancel afspraak

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-1

As a balie user, I want to cancel a scheduled afspraak and optionally record a cancellation
reason so that the behandelaar's calendar is accurate and the history remains traceable.

**FRD trace:** FR-8, FR-11, AC-4, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Successful cancellation of a gepland afspraak
  Given an afspraak has status=gepland
  When I click cancel, optionally enter a reason, and confirm
  Then the afspraak status becomes geannuleerd in Convex
  And the cancellationReason and cancelledAt fields are set (FR-8)
  And an audit_log entry with action=edit, resourceType=afspraak is written

Scenario: Cancelled afspraak remains visible in agenda
  Given an afspraak has been cancelled
  When I view the agenda for that date
  Then the afspraak slot is still visible, displayed as cancelled (e.g., struck-through)

Scenario: Cancelling a voltooid afspraak is blocked
  Given an afspraak has status=voltooid
  When I attempt to cancel it
  Then the Convex mutation returns an invalid-transition error (FR-11, AC-4)

Scenario: Cancellation reason is optional
  Given an afspraak has status=gepland
  When I cancel it without providing a reason
  Then the cancellation succeeds with cancellationReason left empty (A-14)
```

**Size:** 3
**Dependencies:** A-1-S1.

---

#### Story A-1-S4 — Mark afspraak as voltooid

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-1

As a behandelaar, I want to mark an afspraak as voltooid after the session so that the
calendar accurately reflects completed appointments and I can optionally link a behandeling
to it.

**FRD trace:** FR-10, FR-11, FR-14, AC-4, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: behandelaar marks own afspraak as voltooid
  Given I am signed in as behandelaar
  And an afspraak assigned to me has status=gepland or bevestigd
  When I mark it as voltooid
  Then the status transitions to voltooid in Convex
  And an audit_log entry with action=edit, resourceType=afspraak is written

Scenario: System offers shortcut to create a behandeling
  Given I have just marked an afspraak as voltooid
  When the confirmation screen is shown
  Then I see a shortcut/button to create a behandeling linked to this afspraak (FR-14)

Scenario: Invalid transition is rejected
  Given an afspraak has status=geannuleerd
  When I attempt to mark it as voltooid
  Then the Convex mutation returns an invalid-transition error (FR-11, AC-4)

Scenario: balie cannot mark voltooid
  Given I am signed in as balie only
  When I attempt to call the afspraak-voltooid Convex mutation
  Then I receive a permission-denied error (role-permission matrix)
```

**Size:** 3
**Dependencies:** A-1-S1, A-1-S2 (status lifecycle in place).
**Notes:** The behandeling shortcut (FR-14) produces a deep-link or pre-filled form; the
behandeling-create logic lives in the Behandelingen domain. The link is the cross-domain
integration point.

---

### Epic A-2 — Agenda Calendar View

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:afspraken`, `epic`

**Goal / Business Value**
Give behandelaars a real-time view of their own schedule and give balie/admin a view of all
behandelaars' agendas so that the clinic can coordinate scheduling and behandelaars know
exactly which patients to prepare for.

**Scope**
- In scope: day view, week view, current-week default, navigation forward/backward, per-slot
  display (patient display name, behandelsoort, time, duration), behandelaar filter for
  balie/admin, behandelaar sees only own agenda (A-5).
- Out of scope: month view (A-16), external calendar sync, print view.

**Success Metrics**
- A behandelaar opening the agenda sees their current week's afspraken with no additional
  filtering required.
- A balie user can filter the agenda by any behandelaar and switch between day and week views.

**Child Stories**
A-2-S1, A-2-S2

---

#### Story A-2-S1 — Agenda data layer (role-filtered Convex query)

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-2

As a system, I want a Convex query that returns afspraken for a given day or week range with
role-based filtering so that only authorized afspraken are returned — behandelaar sees their
own only, balie and admin see all behandelaars — and the data contract is stable for the
calendar UI to consume.

**FRD trace:** FR-9, A-5, A-15, A-16, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: behandelaar query returns only own afspraken
  Given I am signed in as behandelaar
  And two afspraken exist this week — one for my behandelaarId and one for a different behandelaarId
  When the agenda query runs for the current week
  Then the result contains only the afspraak assigned to my Clerk userId (A-5)
  And the other behandelaar's afspraak is absent

Scenario: balie query returns all behandelaars
  Given I am signed in as balie
  And two afspraken exist this week for two different behandelaars
  When the agenda query runs for the current week with no behandelaar filter
  Then both afspraken are returned

Scenario: balie query filtered by behandelaar returns subset
  Given I am signed in as balie
  And two afspraken exist this week for behandelaar A and behandelaar B
  When the agenda query runs filtered to behandelaar A
  Then only the afspraak for behandelaar A is returned

Scenario: Query scoped to a day range
  Given three afspraken exist — one on Monday, one on Wednesday, one next Monday
  When the agenda query runs with a date range covering Monday to Sunday of the current week
  Then the Monday and Wednesday afspraken are returned
  And the next-Monday afspraak is not included

Scenario: Each returned afspraak includes display fields
  Given an afspraak exists for a patient
  When the agenda query returns it
  Then the result includes startDatetime, durationMinutes, behandelaarId,
       the patient's voornaam and first letter of achternaam (A-15),
       and behandelsoort naam (if set)

Scenario: Unauthenticated call is rejected
  Given no valid Clerk JWT is present
  When the agenda query is called
  Then it returns an auth error and no afspraken data (AC-1)
```

**Size:** 5
**Dependencies:** A-1-S1 (afspraken must exist), F-2-S1 (role authorization helper), F-4-S1 (audit log — view action on agenda open).
**Notes:** The query must enforce role-scoping in the Convex function itself, not in the
frontend. An audit_log entry with action=view, resourceType=afspraak shall be written when
the query executes for an authenticated user (AC-9).

---

#### Story A-2-S2 — Agenda calendar UI (day/week grid)

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:afspraken`, `story`
- Parent epic: Epic A-2

As a behandelaar, I want to view my own agenda for the current week in a day/week calendar
layout so that I know exactly which patients I have scheduled and can prepare accordingly.

**FRD trace:** FR-9, A-5, A-15, A-16.

**Acceptance Criteria**

```gherkin
Scenario: Default view is current week
  Given I open the agenda for the first time today
  When the agenda loads
  Then the current week is displayed in week view (A-16)

Scenario: balie sees all behandelaars and can filter
  Given I am signed in as balie
  When I open the agenda
  Then I see afspraken for all behandelaars by default
  And I can filter by a specific behandelaar to see only their afspraken

Scenario: Agenda slot shows correct information
  Given an afspraak exists for a patient
  When I view the agenda slot for that afspraak
  Then it displays the patient's voornaam and first letter of achternaam (A-15)
  And it shows the behandelsoort (if set), start time, and duration

Scenario: Navigation moves forward and backward by week
  Given I am viewing the current week
  When I click "next week"
  Then the agenda shifts to display the following week's afspraken
  When I click "previous week"
  Then the agenda returns to the current week

Scenario: Day view shows afspraken for a single day
  Given I am viewing the week view
  When I click on a specific day heading to switch to day view
  Then only the afspraken for that day are displayed in the time grid

Scenario: Clicking an afspraak slot opens detail
  Given an afspraak slot is visible in the agenda
  When I click it
  Then I am navigated to or shown the afspraak detail view
```

**Size:** 5
**Dependencies:** A-2-S1 (data-layer query must be complete and stable before the UI can consume it).
**Notes:** The UI consumes the role-filtered query from A-2-S1 via `useQuery`. No data
access logic belongs in this story — if the component needs data behaviour changed, that
change goes in A-2-S1.

---

## Domain 3 — Behandelingen (Treatments)

This domain depends on Domain 0 (Foundation), Epic P-1 (patient lookup), and the behandelsoort
vocabulary (Epic B-3). It also integrates with Afspraken domain via the afspraak-to-behandeling
link (FR-14), but can be built in parallel with Domain 2 once Epic B-3 is done.

---

### Epic B-1 — Behandeling Record Lifecycle

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:behandelingen`, `epic`

**Goal / Business Value**
Enable behandelaars to record, edit, and finalize treatment records so that clinical
encounters are documented accurately and immutably, supporting both care continuity and
AVG-compliant record keeping.

**Scope**
- In scope: record behandeling (FR-13), edit concept behandeling (FR-16), finalize behandeling
  (FR-15), view behandeling detail (FR-17), link to afspraak (FR-14).
- Out of scope: rich-text behandelverslag (plain text in MVP, OQ-20), amendment/addendum
  workflow for definitief records (A-21).

**Success Metrics**
- A behandelaar can record, save, edit, and finalize a behandeling for a patient.
- A definitief behandeling cannot be modified by any Convex mutation, including admin (AC-5).
- Every create/edit/finalize action produces an audit_log entry (AC-9).

**Child Stories**
B-1-S1, B-1-S2, B-1-S3, B-1-S4

---

#### Story B-1-S1 — Record a new behandeling

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-1

As a behandelaar, I want to record a new behandeling for a patient so that the clinical
encounter is documented in the EPD and available for future reference.

**FRD trace:** FR-13, BR-6, BR-12, AC-2, AC-9, A-18, A-19.

**Acceptance Criteria**

```gherkin
Scenario: Successful behandeling creation
  Given I am signed in as behandelaar
  And I select an active patient, a behandelsoort, and enter a behandelverslag
  When I submit the form
  Then a behandeling record with status=concept is created in Convex
  And the behandelaarId is set to my Clerk userId (system-set)
  And an audit_log entry with action=create, resourceType=behandeling is written (AC-9)

Scenario: Future treatment date is rejected
  Given I set the treatmentDate to tomorrow
  When I submit
  Then a validation error is shown and no record is created (BR-6)

Scenario: Back-dating is allowed
  Given I set the treatmentDate to a date one week in the past
  When I submit
  Then the behandeling is created successfully (A-18)

Scenario: behandelsoort is required and must be active
  Given I submit the form without selecting a behandelsoort
  Then a required-field validation error is shown
  Given I select a behandelsoort that is deactivated
  Then a validation error indicates the behandelsoort must be active (BR-12)

Scenario: balie cannot create a behandeling
  Given I am signed in as balie only
  When I attempt to call the behandeling-create Convex mutation directly
  Then I receive a permission-denied error (AC-2)
```

**Size:** 5
**Dependencies:** P-1-S1, P-2-S1, F-2-S1, F-4-S1, B-3-S1.

---

#### Story B-1-S2 — Edit a concept behandeling

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-1

As the behandelaar who recorded a behandeling, I want to edit it while it is in concept status
so that I can correct errors before finalizing the record.

**FRD trace:** FR-16, A-21, AC-5, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Author edits a concept behandeling
  Given I am signed in as the behandelaar who created a concept behandeling
  When I update the behandelverslag and save
  Then the record is updated in Convex
  And an audit_log entry with action=edit, resourceType=behandeling is written

Scenario: Non-author behandelaar cannot edit
  Given behandelaar B created a concept behandeling
  When behandelaar A (different user) attempts to edit it
  Then the Convex mutation returns a permission-denied error (A-21)

Scenario: Admin can edit any concept behandeling
  Given I am signed in as admin
  When I edit a concept behandeling created by any behandelaar
  Then the edit succeeds

Scenario: Edit is blocked on definitief behandeling
  Given a behandeling has status=definitief
  When I attempt to edit it
  Then the Convex mutation rejects the edit (AC-5)
  And the edit option is not shown in the UI
```

**Size:** 3
**Dependencies:** B-1-S1.

---

#### Story B-1-S3 — Finalize a behandeling

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-1

As a behandelaar, I want to finalize a behandeling record so that it is locked against
accidental changes and the clinical content is immutable from that point forward.

**FRD trace:** FR-15, AC-5, AC-9, A-21.

**Acceptance Criteria**

```gherkin
Scenario: Successful finalization
  Given I am signed in as behandelaar and I am the author of a concept behandeling
  When I click "Finalize" and confirm
  Then the status transitions to definitief in Convex
  And finalizedBy is set to my Clerk userId
  And finalizedAt is set to the server timestamp
  And an audit_log entry with action=finalize, resourceType=behandeling is written (AC-9)

Scenario: Definitief record cannot be edited
  Given a behandeling is definitief
  When any Convex mutation attempts to update clinical fields on that record
  Then the mutation is rejected regardless of the caller's role (AC-5)

Scenario: Finalizing a definitief record does nothing (idempotency guard)
  Given a behandeling is already definitief
  When I attempt to finalize it again
  Then the Convex mutation returns an appropriate error (no double-write)
```

**Size:** 3
**Dependencies:** B-1-S1, B-1-S2 (lifecycle established).

---

#### Story B-1-S4 — View behandeling detail

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-1

As any authenticated clinic staff member, I want to view the full detail of a single
behandeling record so that I can review the clinical notes and status of that encounter.

**FRD trace:** FR-17, AC-1, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Authenticated user views behandeling detail
  Given I am signed in (any role)
  When I navigate to a behandeling detail page
  Then I see all fields: patient (by display name), behandelaarId, treatmentDate, behandelsoort,
       behandelverslag, status, and if definitief also finalizedBy and finalizedAt
  And an audit_log entry with action=view, resourceType=behandeling is written (AC-9)

Scenario: Unauthenticated access is blocked
  Given I am not signed in
  When I navigate directly to a behandeling detail URL
  Then I am redirected to sign-in and no data is returned (AC-1)

Scenario: balie sees behandeling detail as read-only
  Given I am signed in as balie
  When I view a behandeling detail
  Then I see the full content but no edit or finalize controls (role-permission matrix)
```

**Size:** 2
**Dependencies:** B-1-S1, F-4-S1.

---

### Epic B-2 — Per-Patient Behandeling History

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:behandelingen`, `epic`

**Goal / Business Value**
Give behandelaars and other staff a chronological list of all behandelingen for a patient so
that treatment history is readily accessible and treatment continuity is supported.

**Scope**
- In scope: chronological list on the patient profile page (FR-18), newest-first default,
  oldest-first toggle, pagination at 20 items, link to full detail per item.
- Out of scope: filtering by behandelsoort, filtering by behandelaar, full-text search over
  behandelverslag.

**Success Metrics**
- A behandelaar can open a patient's treatment history and see all past behandelingen in
  correct chronological order, paginated.

**Child Stories**
B-2-S1

---

#### Story B-2-S1 — View per-patient behandeling history

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-2

As a behandelaar, I want to view a chronological list of all behandelingen for a patient so
that I can review their treatment history before or after a session.

**FRD trace:** FR-18, A-22, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: History list shows most recent first by default
  Given a patient has five behandelingen on different dates
  When I navigate to their treatment history
  Then the list is ordered newest-first by default (FR-18)

Scenario: User can switch to oldest-first order
  Given I am viewing a patient's treatment history in newest-first order
  When I toggle the sort order to oldest-first
  Then the list re-orders to show the oldest behandeling first

Scenario: List paginates at 20 items
  Given a patient has 25 behandelingen
  When I view the history list
  Then I see the first 20 items with a pagination control to view the next set (A-22)

Scenario: Each row links to the full behandeling detail
  Given the history list is showing
  When I click on a behandeling row
  Then I am navigated to that behandeling's detail page (FR-17)

Scenario: History is accessible from the patient profile
  Given I am on a patient's profile page
  When I click "view full treatment history"
  Then I am taken to the full behandeling history list for that patient (FR-3)
```

**Size:** 3
**Dependencies:** B-1-S1, B-1-S4, P-1-S2.

---

### Epic B-3 — Behandelsoort Controlled Vocabulary

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:behandelingen`, `epic`

**Goal / Business Value**
Establish and maintain the shared behandelsoort reference list so that both afspraken and
behandelingen reference a consistent, admin-controlled vocabulary rather than free-text entry,
ensuring data quality and consistent reporting.

**Scope**
- In scope: admin CRUD screen for behandelsoort entries (FR-19); soft-deactivation (no
  hard-delete if referenced); active/inactive filter for dropdowns; the Convex `behandelsoort`
  collection.
- Out of scope: import/export of vocabulary, patient-facing labels, free-text override.

**Success Metrics**
- An admin can create, rename, and deactivate behandelsoort entries.
- Only active entries appear in the dropdown for balie (afspraken) and behandelaar
  (behandelingen).
- A referenced entry cannot be hard-deleted.

**Child Stories**
B-3-S1, B-3-S2

---

#### Story B-3-S1 — Seed and expose behandelsoort dropdown

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-3

As a balie user or behandelaar, I want to see a dropdown of active behandelsoort options when
creating an afspraak or behandeling so that I can categorize the encounter from a consistent,
admin-controlled list.

**FRD trace:** FR-19, BR-12, A-27, A-28.

**Acceptance Criteria**

```gherkin
Scenario: Active behandelsoort entries appear in dropdown
  Given an admin has created three active behandelsoort entries
  When a balie user opens the behandelsoort dropdown on the afspraak form
  Then all three active entries are shown

Scenario: Deactivated entries do not appear in dropdown
  Given one behandelsoort entry has been deactivated
  When a user opens the dropdown
  Then that entry is not listed

Scenario: Convex mutation validates behandelsoortId on save
  Given a behandelsoort entry has been deactivated
  When a Convex mutation for creating an afspraak or behandeling supplies that deactivatedId
  Then the mutation returns a validation error (BR-12)
```

**Size:** 3
**Dependencies:** F-3-S1 (schema with behandelsoort collection), F-2-S1.
**Notes:** This story is a shared dependency for A-1-S1 and B-1-S1. Seed a few default
behandelsoort entries in the Convex dev seed script so other stories can proceed without
waiting for the admin UI.

---

#### Story B-3-S2 — Admin manages behandelsoort vocabulary

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:behandelingen`, `story`
- Parent epic: Epic B-3

As an admin, I want to create, rename, and deactivate behandelsoort entries so that the
controlled vocabulary stays accurate and only relevant treatment types are offered to staff.

**FRD trace:** FR-19, A-27, A-28.

**Acceptance Criteria**

```gherkin
Scenario: Admin creates a new behandelsoort entry
  Given I am signed in as admin
  When I navigate to the behandelsoort management screen and add "Sportmassage"
  Then a new active behandelsoort entry "Sportmassage" is created in Convex
  And it appears immediately in the dropdown for balie and behandelaar users

Scenario: Admin renames a behandelsoort entry
  Given an entry named "Klassiek" exists
  When I rename it to "Klassieke massage"
  Then the entry is updated in Convex
  And existing afspraken and behandelingen that reference it now display the new name

Scenario: Admin deactivates a behandelsoort entry
  Given an active entry exists
  When I deactivate it
  Then its `actief` flag is set to false
  And it no longer appears in the dropdown for new afspraken or behandelingen

Scenario: Referenced entry cannot be hard-deleted
  Given an entry is referenced by at least one afspraak or behandeling
  When I attempt a hard-delete via the UI or directly via Convex mutation
  Then the mutation returns an error explaining the entry is referenced (A-27)
  And the entry remains in the database (soft-delete / deactivation is the only allowed path)

Scenario: Non-admin cannot manage vocabulary
  Given I am signed in as balie or behandelaar
  When I attempt to access the behandelsoort management screen
  Then I receive an access-denied response (A-28)
```

**Size:** 5
**Dependencies:** B-3-S1 (collection and dropdown must exist first), F-2-S1.

---

## Domain 4 — Audit Trail

The audit-trail infrastructure (data model, write helper, no-PII guarantee) lives in
Domain 0 (Epic F-4). This domain covers the verification and completeness guarantees that
cut across all other domains.

---

### Epic AT-1 — Audit Log Completeness Verification

**GitHub Issues metadata**
- Type: `epic`
- Labels: `domain:audittrail`, `epic`

**Goal / Business Value**
Verify, through automated tests, that every patient and behandeling data operation across all
domains produces a compliant, PII-free audit log entry, satisfying AVG Art. 5(2) accountability
requirements from the first release.

**Scope**
- In scope: integration tests verifying audit entries exist for all action types (create, edit,
  view, deactivate, finalize) across patient and behandeling resources; assertion that no entry
  payload contains PII; test coverage confirming BR-13 (parent operation rolls back if audit
  write fails).
- Out of scope: audit log UI for staff (explicitly out of MVP), full Art. 30 register, afspraak
  audit coverage beyond what is tracked (afspraak is captured under FR-20's implicit scope).

**Success Metrics**
- AC-9 is verified: every covered operation produces exactly one audit entry.
- AC-7 is verified: no audit entry contains patient name, BSN, email, address, or clinical text.

**Child Stories**
AT-1-S1

---

#### Story AT-1-S1 — Audit log integration test suite

**GitHub Issues metadata**
- Type: `story`
- Labels: `domain:audittrail`, `story`
- Parent epic: Epic AT-1

As a developer/quality assurance engineer, I want an automated test suite that verifies audit
log entries are created for all covered operations and contain no PII so that AVG accountability
compliance can be confirmed on every build.

**FRD trace:** FR-20, BR-13, AC-7, AC-9.

**Acceptance Criteria**

```gherkin
Scenario: Audit entry exists for patient create
  Given a Vitest test calls the patient-create Convex mutation with anonymized data
  When the mutation completes
  Then exactly one audit_log entry with action=create, resourceType=patient exists
  And the entry payload contains no name, BSN, email, address, or clinical text

Scenario: Audit entry exists for patient edit
  Given a test calls the patient-edit mutation
  When it completes
  Then an audit_log entry with action=edit, resourceType=patient exists with no PII

Scenario: Audit entry exists for patient view
  Given a test calls the patient-get query
  When it completes
  Then an audit_log entry with action=view, resourceType=patient exists

Scenario: Audit entry exists for behandeling create, edit, and finalize
  Given tests call the behandeling create, edit, and finalize mutations
  Then corresponding audit_log entries with actions create, edit, and finalize exist

Scenario: Parent operation rolls back if audit write fails
  Given the audit_log write is mocked to fail
  When the parent patient-create mutation runs
  Then no patient record is created (BR-13 rollback)

Scenario: Test fixtures use only synthetic data
  Given all test fixtures in the test suite
  When inspected
  Then no real patient names, real BSNs, real email addresses, or real clinical notes appear
       in any fixture, seed file, or CI output (BR-10)
```

**Size:** 5
**Dependencies:** F-4-S1, P-1-S1, P-1-S3, P-1-S4, B-1-S1, B-1-S2, B-1-S3.
**Notes:** These tests should run in CI on every pull request. Anonymized synthetic data
must be used (BR-10); never use real clinic data.

---

## Build Order

The following sequence defines the order in which domains, epics, and stories should be
built. Stories are ordered by: (1) dependency satisfaction, (2) value delivery,
(3) risk/uncertainty. Work within the same sprint slot can be parallelized as long as no
dependency is violated.

### Domain-level sequence

```
Domain 0 (Foundation) → Domain 1 (Patiëntbeheer) → Domain 3 / Domain 2 (parallel)
  → Domain 4 (Audit Trail verification, continuous)
```

- Domain 0 is entirely foundational; nothing else can start.
- Domain 1 must come before Domain 2 and Domain 3 because patients are referenced by both.
- Domain 2 (Afspraken) and Domain 3 (Behandelingen) share a dependency on the behandelsoort
  vocabulary (Epic B-3, which lives in Domain 3). Therefore B-3 must be prioritized within
  Domain 3 before A-1 (Afspraken) can fully complete.
- Domain 4 (Audit Trail) infrastructure is built in Domain 0 (Epic F-4); the verification
  story (AT-1-S1) is done last, once all other domains are feature-complete.

### Ordered build list

**Sprint 1 — Foundation**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 1 | F-1-S1 — Project scaffold | — | Nothing can start without this |
| 2 | F-1-S2 — Clerk auth integration | F-1-S1 | Auth required before any protected page |
| 3 | F-2-S1 — Role-authorization helper | F-1-S2 | All domain stories need this |
| 4 | F-3-S1 — Convex schema bootstrap | F-2-S1 | Schema must precede all Convex functions |
| 5 | F-4-S1 — Audit log write helper | F-3-S1 | Domain stories need audit from day one |

These five stories form the thin end-to-end slice: signed-in user, role check, schema, audit.
They should all land in Sprint 1.

**Sprint 2 — Patiëntbeheer + Vocabulary foundation**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 6 | B-3-S1 — Behandelsoort dropdown (seed + expose) | F-3-S1, F-2-S1 | Shared dependency for A-1 and B-1; seed it early |
| 7 | P-1-S1 — Create patient | F-3-S1, F-2-S1, F-4-S1 | Core value; all other domain flows need a patient |
| 8 | P-1-S2 — View patient profile | P-1-S1, F-4-S1 | Enables thin end-to-end slice for patient domain |
| 9 | P-2-S1 — Search patients | P-1-S1, F-4-S1 | Required by afspraak create and behandeling create |

**Sprint 3 — Patiëntbeheer completion + Afspraken start**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 10 | P-1-S3 — Edit patient | P-1-S1, P-1-S2, F-4-S1 | Completes patient CRUD |
| 11 | P-1-S4 — Deactivate patient | P-1-S1, P-1-S2, F-4-S1 | Completes patient lifecycle |
| 12 | F-3-S2 — Admin user management | F-1-S2, F-2-S1, F-3-S1 | Enables admin to manage behandelaar accounts |
| 13 | A-1-S1 — Create afspraak | P-1-S1, P-2-S1, F-2-S1, F-4-S1, B-3-S1 | Core scheduling value |

**Sprint 4 — Afspraken completion + Behandelingen start**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 14 | A-1-S2 — Edit afspraak | A-1-S1 | Reschedule capability |
| 15 | A-1-S3 — Cancel afspraak | A-1-S1 | Cancel capability |
| 16 | A-1-S4 — Mark afspraak voltooid | A-1-S1, A-1-S2 | Completes status lifecycle; enables behandeling link |
| 17 | B-1-S1 — Record behandeling | P-1-S1, P-2-S1, F-2-S1, F-4-S1, B-3-S1 | Core clinical documentation value |

**Sprint 5 — Behandelingen completion + Agenda data layer**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 18 | B-1-S2 — Edit concept behandeling | B-1-S1 | Completes behandeling authoring |
| 19 | B-1-S3 — Finalize behandeling | B-1-S1, B-1-S2 | Immutability guarantee |
| 20 | B-1-S4 — View behandeling detail | B-1-S1, F-4-S1 | Required for history list |
| 21 | B-2-S1 — Behandeling history list | B-1-S1, B-1-S4, P-1-S2 | Completes behandelingen domain |
| 22 | A-2-S1 — Agenda data layer (role-filtered query) | A-1-S1, F-2-S1, F-4-S1 | Data contract must exist before UI; size 5 |

**Sprint 6 — Agenda calendar UI + Vocabulary management + Audit verification**

| Order | Story | Depends on | Rationale |
|-------|-------|-----------|-----------|
| 23 | A-2-S2 — Agenda calendar UI (day/week grid) | A-2-S1 | UI consumes stable data-layer query; size 5 |
| 24 | B-3-S2 — Admin manages behandelsoort | B-3-S1, F-2-S1 | Admin vocabulary control; can follow domain features |
| 25 | AT-1-S1 — Audit log test suite | F-4-S1 + all domain stories | Verification pass once all domains are feature-complete |

---

## Open Questions & Risks

### Open Questions (from FRD, unresolved)

| ID | Domain | Question | Impact on backlog |
|----|--------|----------|-------------------|
| OQ-1 | General | Current state of patient administration (paper vs. legacy software) | Data migration may add scope post-MVP; not blocking. |
| OQ-2 | General | Target concurrent users and total patient record volume | May require performance testing story; search cap (A-10) may need tuning. |
| OQ-3 | General | Specific AVG documentation requirements (verwerkersovereenkomst with Convex) | Legal paperwork; not a code story but blocks production use. |
| OQ-10 | Patiëntbeheer | Deactivated patient visibility policy for behandelaars (historical records accessible?) | Assumed accessible (A-11); confirm before P-1-S4 sprint planning. |
| OQ-12 | Afspraken | Confirm 30-minute default duration | Low risk; assumption A-12 is reasonable. |
| OQ-15 | Afspraken | Month view required in MVP? | Assumed no (A-16); confirm before A-2-S2. |
| OQ-16 | Afspraken | In-app notification when afspraak marked voltooid? | Out of scope assumed; confirm. |
| OQ-17 | Behandelingen | Maximum back-date window for behandelingen? | Assumed unlimited (A-18); confirm. |
| OQ-20 | Behandelingen | Rich text vs. plain text for behandelverslag? | Plain text assumed; if rich text needed, B-1-S1 size increases. |
| OQ-21 | Behandelingen | Can behandelaar edit another's concept behandeling? | Author-only assumed (A-21); confirm. |
| OQ-22 | Behandelingen | Expected volume of behandelingen per patient (pagination threshold)? | Pagination at 20 assumed (A-22); confirm. |
| OQ-26 | UX | Session-expiry modal vs. silent redirect? | Silent redirect assumed (A-26); low risk. |

### Stories flagged as too large (>= 8 — review before sprint planning)

No stories are currently estimated above 8. The previously flagged story has been split:

| Original story | Original size | Action taken | Resulting stories |
|----------------|--------------|--------------|-------------------|
| A-2-S1 — Agenda day/week view | 8 | Split into two stories | A-2-S1 Agenda data layer (5) + A-2-S2 Agenda calendar UI (5) |

### Notable risks and dependencies

1. **B-3-S1 is a shared blocker.** The behandelsoort vocabulary story must be done before
   both A-1-S1 (afspraak create) and B-1-S1 (behandeling record) can be considered complete,
   because both forms require an active behandelsoort dropdown. Seeding default entries early
   unblocks parallel work.

2. **F-3-S2 (admin user management) requires a Convex Action calling the Clerk Management
   API.** This is more complex than a standard mutation and involves storing a Clerk API key
   as a Convex environment secret. Spike this early if the team is unfamiliar with the
   Clerk Management API.

3. **AVG/GDPR data residency (BR-9) is an explicit production blocker.** Convex Cloud runs
   on AWS (typically US regions). This is accepted for the POC but must be resolved before
   any real patient data is processed. This is not a story in this backlog but must be tracked
   as a production-phase dependency outside the MVP.

4. **Audit log in-path requirement (BR-13).** The requirement that the audit write is
   non-deferrable and causes the parent operation to roll back if it fails is a Convex-specific
   design constraint. This must be verified during F-4-S1 implementation; Convex mutations are
   transactional, so the pattern is achievable, but the team should validate it with a proof-
   of-concept test before relying on it across all domain stories.

5. **BSN no-log rule (BR-11, AC-7).** The BSN must never appear in Convex function logs or
   error messages, even though it is a required field and a search key. This cross-cuts P-1-S1,
   P-1-S3, and P-2-S1. Reviewers should check all error-handling paths for BSN leakage. A
   specific test scenario is included in AT-1-S1.

6. **Concurrent-edit last-write-wins (EH-2, A-24).** No optimistic locking is implemented
   in the MVP. This is an accepted risk for the POC but should be called out to the product
   owner before any production rollout where concurrent editing of patient records is likely.

---

## GitHub Issues publishing checklist

When the product owner approves this backlog for publication to GitHub Issues, create:

1. One issue per **epic** (type: `epic`) with: title, goal, scope, success metrics, and a
   list of child story references (to be linked once story issues are created).
2. One issue per **user story** (type: `story`) with: story statement, acceptance criteria,
   FR-N trace, size estimate, and dependencies (reference epic issue number in body).
3. Apply two labels per issue: `domain:<domain>` and either `epic` or `story`.
   Suggested domain labels: `domain:foundation`, `domain:patientbeheer`, `domain:afspraken`,
   `domain:behandelingen`, `domain:audittrail`.
4. Set stories to `ready` status only once all their dependencies have been created and are
   themselves in a ready or done state; leave dependent stories `blocked` with a note
   referencing the blocking issue number.
5. Publish in build-order sequence so that issue numbers roughly reflect priority.

Total: 8 epics, 25 stories.
