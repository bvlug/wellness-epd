# EPD MVP — Functional Requirements Document

> **Version:** 0.4-draft
> **Date:** 2026-06-02
> **Status:** Draft — pending stakeholder review
> **Author:** functional-requirements-po agent
> **Language policy:** This document is an internal artifact and is therefore written in English.
> Dutch domain terms (`patient`, `afspraak`, `behandeling`, `behandelaar`, `balie`) are kept
> as the ubiquitous language per CLAUDE.md conventions.

### Revision history

| Version | Date | Summary of changes |
|---|---|---|
| 0.1-draft | 2026-06-02 | Initial draft. |
| 0.2-draft | 2026-06-02 | Four open questions resolved: (1) OQ-7 — BSN is now **required** (was optional); Elfproef validation and AVG sensitivity note retained. (2) OQ-6 — `geslacht` confirmed required with vocabulary `man/vrouw/overig/onbekend`; assumption A-6 confirmed. (3) OQ-13 — `behandelsoort` is now a **shared controlled vocabulary** (reference table `behandelsoort`) used by both afspraken and behandelingen; new FR-19 and data-model entry added. (4) OQ-14 — afspraak overlap is confirmed a **soft warning** (non-blocking); assumption A-17 confirmed. |
| 0.3-draft | 2026-06-02 | Four open questions resolved: (1) OQ-5 — no read-only viewer role; three roles confirmed sufficient; A-1 confirmed. (2) OQ-24 — basic audit trail is **now in scope** for MVP; FR-20, `audit_log` data-model collection, and BR-13 added; Out-of-Scope row updated. (3) OQ-11 — no operating-hours enforcement; balie may schedule at any time; A-16 confirmed. (4) OQ-9 — `huisarts` field **removed entirely**; FR-1 table and patient data model updated; A-8 superseded. |
| 0.4-draft | 2026-06-02 | Four open questions resolved: (1) OQ-4 — a user MAY hold multiple roles simultaneously; effective permissions are the union of held roles (additive); A-2 confirmed; role-permission matrix note added. (2) OQ-8 — NO additional field-level encryption for BSN or any field in MVP; Convex at-rest encryption accepted; BR-11 production note updated. (3) OQ-23 — **BSN is NOT masked for any role** (reversal of prior assumption A-23); full BSN visible to all roles that can view a patient (`behandelaar`, `balie`, `admin`); BR-3 overhauled (masking rule removed; balie BSN-search restriction lifted); BR-11 masking bullet removed; FR-4 BSN search opened to all roles; A-23 superseded. (4) OQ-25 — patient contact details (email, phone, address) visible to ALL viewing roles without restriction; existing assumption confirmed. |

---

## Summary

This document specifies the functional requirements for the Minimum Viable Product (MVP) of
the EPD (Elektronisch Patiëntendossier — electronic patient record) for a wellness clinic.
The EPD is a web application built on Next.js, Convex, and Clerk that enables clinic staff to
manage patient profiles, schedule and track afspraken (appointments), and record behandelingen
(treatments) and per-patient treatment history.

The MVP is scoped to three domains:

1. **Patiëntbeheer** — create, search, and view patient profiles.
2. **Afspraken / Agenda** — schedule appointments and view the treatment calendar.
3. **Behandelingen** — record treatments and view per-patient treatment history.

The system is being developed as a proof of concept. However, because it handles patient-shaped
data, all requirements are written with AVG/GDPR compliance in mind from the outset.

---

## Goal & Business Value

The wellness clinic currently manages patient information, appointments, and treatment records
using paper-based or ad-hoc digital methods (assumption — see OQ-1). This creates inefficiencies
in scheduling, makes treatment history difficult to retrieve, and poses a data-management and
privacy risk. The EPD MVP aims to:

- Provide a single, authorized digital source of truth for patient records.
- Streamline appointment scheduling for reception staff (balie).
- Enable behandelaars (practitioners) to quickly record and review treatment history.
- Establish a privacy-first data model that can grow towards AVG/GDPR production compliance.

---

## Actors / Roles

Authentication is handled by **Clerk**. The following roles are defined in the system:

| Role | Dutch label | Description |
|---|---|---|
| `admin` | Beheerder | Full access; manages users, roles, and system configuration. |
| `behandelaar` | Behandelaar | Creates and views behandelingen; views patient records and their own agenda. |
| `balie` | Balie | Creates and manages patients and afspraken; read-only on behandelingen. |

> **Assumption A-1:** Three roles suffice for the MVP. A fourth role (e.g., read-only
> viewer / referring physician) is not in scope. **Confirmed by stakeholder (OQ-5 resolved
> v0.3).**
>
> **Assumption A-2:** A single staff member may hold multiple roles simultaneously (e.g., a
> behandelaar who also performs balie tasks). Clerk allows multiple roles per user.
> **Confirmed by stakeholder (OQ-4 resolved v0.4).** When a user holds more than one role,
> their effective permissions are the **union** of all held roles' permissions (additive model).
> There are no permission subtractions or conflicts between roles.
>
> **Assumption A-3:** Patients themselves do not log in to the system in the MVP. There is
> no patient-facing portal.

### Role-permission matrix (MVP)

| Capability | admin | behandelaar | balie |
|---|:---:|:---:|:---:|
| Manage users / roles | Yes | No | No |
| Manage behandelsoort vocabulary | Yes | No | No |
| Create / edit patient | Yes | No | Yes |
| View patient profile (incl. full BSN) | Yes | Yes | Yes |
| Search patients (incl. BSN search) | Yes | Yes | Yes |
| Create / edit afspraak | Yes | No | Yes |
| View agenda (all behandelaars) | Yes | No | Yes |
| View own agenda | Yes | Yes | Yes |
| Create behandeling | Yes | Yes | No |
| View behandelingen (patient) | Yes | Yes | Yes (read-only) |

> **Permissions are additive across roles (OQ-4 resolved v0.4).** A user holding more than
> one role receives the union of all those roles' permissions. For example, a user with both
> `behandelaar` and `balie` roles can create behandelingen AND manage afspraken. No role
> subtracts permissions granted by another. Convex authorization functions must evaluate the
> full set of roles held by the authenticated user.
>
> **Assumption A-4:** Balie role can read behandelingen for scheduling context but cannot
> create or edit them.
>
> **Assumption A-5:** A behandelaar can only see afspraken in their own agenda unless
> they are also admin. Balie and admin can see all behandelaars' agendas.

---

## Functional Requirements

Requirements are organized by domain. All functional requirements carry a stable `FR-N`
identifier. Requirements marked `[ASSUMPTION]` depend on an assumption listed in the
Open Questions section; the assumption label is cross-referenced.

---

### Domain 1 — Patiëntbeheer (Patient Management)

#### FR-1 — Create patient record
The system shall allow a user with the `balie` or `admin` role to create a new patient record
by providing the following fields:

| Field | Required | Notes |
|---|---|---|
| First name (`voornaam`) | Yes | |
| Last name (`tussenvoegsel` + `achternaam`) | Yes | Tussenvoegsel (infix) optional |
| Date of birth (`geboortedatum`) | Yes | ISO 8601 date; must be in the past |
| Gender (`geslacht`) | Yes | Controlled vocabulary: `man`, `vrouw`, `overig`, `onbekend`; see BR-1 |
| BSN (Burgerservicenummer) | **Yes** | 9-digit Dutch citizen service number; validated by Elfproef (BR-2); AVG-sensitive field (BR-11) |
| Email address | No | Validated as RFC 5322 email format |
| Phone number (`telefoonnummer`) | No | Free-text, no strict format enforced in MVP |
| Address (`adres`) | No | Street, house number, postal code, city |
| Notes (`notities`) | No | Free-text, max 2 000 characters |

On successful creation, the system shall:
- Generate a unique, system-assigned patient identifier (`patientId`).
- Persist the record via the appropriate Convex mutation.
- Return the user to the newly created patient's profile page.

#### FR-2 — Edit patient record
The system shall allow a user with the `balie` or `admin` role to edit any field of an existing
patient record. Editing shall be available from the patient profile page. On save, the system
shall overwrite the record via a Convex mutation that re-validates all fields. Partial updates
are permitted (only changed fields need to be submitted — Assumption A-9).

#### FR-3 — View patient profile
The system shall allow any authenticated user (all roles) to view a read-only patient profile
page that displays all fields defined in FR-1, the patient's upcoming afspraken, and a summary
list of their behandelingen (most recent five, with a link to the full history).

#### FR-4 — Search patients
The system shall provide a patient-search capability accessible to all authenticated users.
Search shall support:
- Full or partial match on `voornaam`, `achternaam`, or the combination.
- Exact match on `geboortedatum` (entered as a date picker).
- Exact match on BSN (available to **all authenticated roles** — see BR-3). Because BSN is mandatory on every patient record, BSN search is a reliable unique-lookup path.

Results shall display: last name, first name, date of birth, and patient ID.
Results shall be limited to a maximum of 50 records per query [ASSUMPTION A-10].
An empty-string search or no active filter shall not return all patients (see BR-4).

#### FR-5 — Deactivate patient record
The system shall allow a user with the `admin` role to deactivate (soft-delete) a patient
record. A deactivated patient shall:
- No longer appear in search results by default.
- Remain in the database (hard deletion is not supported in the MVP — see Out of Scope).
- Be viewable by `admin` when using an explicit "include inactive" filter.
- Not be assignable to new afspraken.

> **Assumption A-11:** Physical deletion of patient data (right to erasure / GDPR Art. 17)
> is an operational process to be designed for production, not the MVP. The MVP provides
> soft-deactivation as a placeholder.

---

### Domain 2 — Afspraken / Agenda (Appointments / Calendar)

#### FR-6 — Create afspraak
The system shall allow a user with the `balie` or `admin` role to create an afspraak by
providing:

| Field | Required | Notes |
|---|---|---|
| Patient | Yes | Selected from patient search; must be an active patient |
| Behandelaar | Yes | Selected from the list of active `behandelaar` users |
| Date and start time | Yes | Must be in the future at time of creation |
| Duration | Yes | In minutes; default 30 min [ASSUMPTION A-12]; controlled list or free entry |
| Treatment type (`behandelsoort`) | No | Reference to a value from the shared `behandelsoort` controlled vocabulary (FR-19); presented as a dropdown |
| Notes (`notities`) | No | Free-text, max 500 characters |
| Status | System-set | Default `gepland` on creation |

On successful creation the system shall confirm the afspraak and reflect it immediately in
the agenda view (reactive via Convex).

#### FR-7 — Edit afspraak
The system shall allow a user with the `balie` or `admin` role to edit an existing afspraak's
date/time, duration, behandelsoort, and notes, provided the afspraak status is `gepland` or
`bevestigd`. Editing an afspraak in status `voltooid` or `geannuleerd` is not permitted.

#### FR-8 — Cancel afspraak
The system shall allow a user with the `balie` or `admin` role to cancel an afspraak. On
cancellation:
- The system shall set the status to `geannuleerd`.
- The system shall record the cancellation timestamp.
- The system shall accept an optional cancellation reason (free-text, max 500 characters)
  [ASSUMPTION A-14].
- The cancelled afspraak shall remain visible in the agenda (struck-through or distinguished
  visually) and in the patient's afspraken history.

#### FR-9 — View agenda — day / week view
The system shall provide a calendar/agenda view with day and week perspectives.

- **Balie / admin:** sees all behandelaars' afspraken, filterable by behandelaar.
- **Behandelaar:** sees only their own afspraken.

Each afspraak slot shall display: patient name (display name only — first name + last name
initial [ASSUMPTION A-15]), behandelsoort, start time, and duration. Clicking an afspraak
slot opens the afspraak detail.

Navigation shall allow moving forward and backward by day or week. The default view on opening
shall be the current week [ASSUMPTION A-16].

#### FR-10 — Mark afspraak as voltooid
The system shall allow a `behandelaar` or `admin` to mark an afspraak as `voltooid` (completed).
This transitions the status from `gepland` or `bevestigd` to `voltooid`.
A `voltooid` afspraak can optionally be linked to a behandeling (see FR-14).

#### FR-11 — Afspraak status lifecycle
The system shall enforce the following valid status transitions:

```
gepland --> bevestigd --> voltooid
gepland --> geannuleerd
bevestigd --> geannuleerd
gepland --> bevestigd (re-open from cancellation is NOT supported in MVP)
```

Any attempt to transition to an invalid status shall be rejected by the Convex mutation
with an appropriate error.

#### FR-12 — Conflict detection
The system shall detect and warn when a new or rescheduled afspraak overlaps with an existing
`gepland` or `bevestigd` afspraak for the same behandelaar.
The overlap warning shall be non-blocking in the MVP [ASSUMPTION A-17]: the balie user sees
the conflict warning but can still save the afspraak.

---

### Domain 3 — Behandelingen (Treatments)

#### FR-13 — Record behandeling
The system shall allow a user with the `behandelaar` or `admin` role to record a new
behandeling for a patient. The following fields shall be captured:

| Field | Required | Notes |
|---|---|---|
| Patient | Yes | Selected from patient search; must be active |
| Behandelaar | System-set | The currently authenticated user (behandelaar) |
| Date of treatment | Yes | Defaults to today; can be back-dated [ASSUMPTION A-18] |
| Start time | No [ASSUMPTION A-19] | HH:MM |
| Duration (minutes) | No | Integer |
| Behandelsoort | Yes | Reference to a value from the shared `behandelsoort` controlled vocabulary (FR-19); presented as a dropdown |
| Behandelverslag (treatment notes) | Yes | Free-text, no hard character limit in MVP |
| Linked afspraak | No | Optional FK to an afspraak; populated if accessed from a `voltooid` afspraak |
| Status | System-set | `concept` on initial save; `definitief` on explicit finalization |

#### FR-14 — Link behandeling to afspraak
The system shall allow a behandeling to be linked to exactly one afspraak. When a behandelaar
marks an afspraak as `voltooid` (FR-10), the system shall offer a shortcut to create or attach
a behandeling for that afspraak. The link is optional; a behandeling can exist without an
afspraak link.

#### FR-15 — Finalize behandeling
The system shall allow a `behandelaar` or `admin` to finalize a behandeling by transitioning
its status from `concept` to `definitief`. Once `definitief`:
- The behandeling record shall be immutable (no edits to clinical content).
- The finalizing user and timestamp shall be recorded.

> **Assumption A-21:** Amendments to finalized behandelingen are out of scope for MVP.
> A correction workflow (addendum) may be added in a later iteration.

#### FR-16 — Edit behandeling (concept only)
The system shall allow the `behandelaar` who created the behandeling, or an `admin`, to edit
a behandeling while its status is `concept`. Editing is blocked once the status is `definitief`.

#### FR-17 — View behandeling detail
The system shall allow any authenticated user (all roles) to view the full detail of a single
behandeling record, subject to the role-permission matrix (balie: read-only).

#### FR-18 — View per-patient behandeling history
The system shall provide a chronological list view of all behandelingen for a given patient,
accessible from the patient profile page. The list shall display:
- Date of treatment
- Behandelsoort
- Behandelaar name
- Status (`concept` / `definitief`)
- Link to the full behandeling detail

The list shall be ordered newest-first by default and shall support ordering by oldest-first.
Pagination or infinite scroll shall be applied when the list exceeds 20 items [ASSUMPTION A-22].

#### FR-19 — Manage behandelsoort controlled vocabulary
The system shall maintain a shared controlled vocabulary of behandelsoort values, stored in a
dedicated `behandelsoort` reference collection in Convex. This vocabulary is used by both
afspraken (FR-6) and behandelingen (FR-13); they reference the same list.

The following rules apply:

- A user with the `admin` role shall be able to create, rename, and deactivate behandelsoort
  entries via an admin management screen.
- Only active entries shall appear in the dropdown presented to `balie` and `behandelaar` users.
- A behandelsoort entry that is referenced by at least one afspraak or behandeling shall not be
  hard-deleted; it may only be deactivated (soft-delete), so that existing records continue to
  display the correct label [ASSUMPTION A-27].
- The `behandelsoort` field on an afspraak is optional (FR-6). The `behandelsoort` field on a
  behandeling is required (FR-13). Both fields reference a `behandelsoortId` from this table.
- The vocabulary list is managed by the `admin` role [ASSUMPTION A-28].

---

### Domain 4 — Audit Trail

#### FR-20 — Record audit log entries for patient and behandeling data access
The system shall record an audit log entry every time a Convex function creates, edits, or
reads patient data or behandeling data, in support of the controller's accountability
obligations under AVG Art. 5(2) and Art. 30 (records of processing activities).

Each audit log entry shall capture:

| Field | Notes |
|---|---|
| `actorId` | Clerk user ID of the authenticated user performing the action; never a name or other PII |
| `actorRole` | The role(s) of the actor at the time of the action |
| `action` | Enumerated action type: `create`, `edit`, `view`, `deactivate`, `finalize` |
| `resourceType` | The Convex collection affected: `patient`, `afspraak`, `behandeling`, or `behandelsoort` |
| `resourceId` | The Convex document `_id` of the affected record |
| `timestamp` | Server-side epoch ms timestamp at the moment the Convex function executes |

The following constraints apply:

- Audit log entries shall be **append-only and immutable**. No Convex mutation shall update or
  delete an existing entry.
- Audit log entries shall contain **no patient-identifying content** in their payload. Records
  are referenced by system ID only (`resourceId`). This is consistent with the CLAUDE.md
  no-PII-in-logs rule and with BR-10.
- Every Convex function that touches `patient` or `behandeling` data shall write an audit log
  entry as part of its execution. The audit write shall occur within the same authorized
  mutation or query path — not as a separate, deferrable side-effect (see BR-13).
- The audit log is **not queryable via the application UI** in the MVP (a queryable audit-log
  UI is a future iteration); however, entries are stored durably in Convex and are accessible
  via the Convex dashboard for operational review.
- A fuller Art. 30 register (data-flow mapping, legal bases, retention periods, processor
  agreements) remains a production-phase concern and is not covered by this requirement.

---

## Candidate User Stories (seeds only)

These are seed-level story titles to orient the `agile-epic-story-writer` agent downstream.
They are not sprint-ready; full decomposition, Gherkin criteria, and sizing happen in that
subsequent step.

**Patiëntbeheer**
- As a balie user, I want to create a patient record, so that the patient is registered in the system.
- As a balie user, I want to edit a patient's details, so that the record stays current.
- As a behandelaar, I want to search for a patient by name or date of birth, so that I can quickly navigate to their record.
- As an admin, I want to deactivate a patient record, so that inactive patients no longer appear in daily workflows.

**Afspraken / Agenda**
- As a balie user, I want to schedule an afspraak for a patient with a behandelaar, so that the appointment is registered and visible in the agenda.
- As a balie user, I want to cancel an afspraak and record a reason, so that the behandelaar's calendar is accurate.
- As a behandelaar, I want to view my agenda for the current week, so that I know which patients to expect.
- As a balie user, I want to be warned when an afspraak overlaps with an existing appointment, so that I can avoid double-bookings.

**Behandelingen**
- As a behandelaar, I want to record a behandeling for a patient after the appointment, so that the clinical encounter is documented.
- As a behandelaar, I want to finalize a behandeling record, so that it is locked and cannot be accidentally altered.
- As a behandelaar, I want to view a patient's behandeling history, so that I can review previous treatments before the next session.

---

## Acceptance Criteria (requirement-level)

These conditions verify the MVP as a whole. Per-story Gherkin scenarios are produced
downstream by the `agile-epic-story-writer`.

**AC-1 — Authentication gate:** No page or Convex function in the EPD returns patient data
to an unauthenticated request. Any attempt returns HTTP 401 / Convex auth error.

**AC-2 — Role enforcement:** All role boundaries in the permission matrix shall be
programmatically enforced inside Convex functions. A balie user calling a behandeling-create
mutation shall receive a permission-denied error regardless of UI state.

**AC-3 — Patient lifecycle:** A patient record can be created, viewed, edited, and
deactivated. Search does not return deactivated patients unless the admin uses the
"include inactive" filter.

**AC-4 — Afspraak lifecycle:** All status transitions in FR-11 are enforced; invalid
transitions are rejected. A cancelled afspraak remains in the database and in history views.

**AC-5 — Behandeling immutability:** A `definitief` behandeling record cannot be modified
via any Convex mutation, regardless of caller role (admin included), except by a dedicated
future correction workflow that is explicitly out of MVP scope.

**AC-6 — Data isolation:** A behandelaar cannot view afspraken or behandelingen belonging to
another behandelaar's patients unless they share the same patient (i.e., a patient may be seen
by multiple behandelaars; the shared patient record is accessible to all authorized roles).

**AC-7 — No PII in logs:** End-to-end testing shall verify that Convex function logs do not
contain patient names, BSNs, or behandelverslag text.

**AC-8 — Conflict warning:** Creating an afspraak that overlaps an existing `gepland` or
`bevestigd` appointment for the same behandelaar displays a visible warning before the user
can confirm the save.

**AC-9 — Audit log completeness:** Every create, edit, view, deactivate, and finalize
operation on a `patient`, `afspraak`, or `behandeling` record shall produce a corresponding
entry in the `audit_log` collection, verifiable in the Convex dashboard. No audit entry shall
contain a patient name, BSN, email, address, or `behandelverslag` text.

---

## Business Rules & Constraints

**BR-1 — Geslacht vocabulary:** Accepted values for `geslacht` are: `man`, `vrouw`, `overig`,
`onbekend`. This is a **confirmed stakeholder decision** (OQ-6 resolved). The value aligns
with Dutch healthcare terminology (NEN 7510 / BIG-register direction). The list is a
system-managed controlled vocabulary; free-text entry is not permitted. The field is required
on patient creation.

**BR-2 — BSN validation:** The BSN (Dutch citizen service number) is a **required** field on
every patient record (OQ-7 resolved). The system shall validate the entered value using the
Elfproef (11-proof algorithm). An invalid BSN shall be rejected with a validation error before
the record is persisted. A blank or missing BSN shall also cause a validation error (field is
mandatory).

**BR-3 — BSN visibility (no masking):** The full BSN shall be visible in the UI to every
authenticated role that is permitted to view a patient (`behandelaar`, `balie`, and `admin`).
No role-based masking or partial obscuring of the BSN is applied in the MVP. All authenticated
roles may also search by exact BSN (see FR-4). **This decision was made at OQ-23 resolution
(v0.4) and supersedes assumption A-23, which previously masked BSN for the `balie` role.**
The BSN remains a sensitive identifier under AVG/GDPR; the no-PII-in-logs constraint (BR-10,
AC-7) continues to apply — the BSN must never appear in Convex function logs, error messages,
or CI output, regardless of the change to UI visibility.

**BR-4 — Search requires input:** Submitting a patient search with no filter criteria shall
return zero results and display a "please enter search criteria" message. This prevents
inadvertent bulk retrieval of patient records.

**BR-5 — Future-only afspraken on creation:** New afspraken may only be scheduled for a
date/time in the future (relative to the server clock at the time the Convex mutation runs).
Editing an existing afspraak may preserve a past date/time if the record was created correctly
in the past.

**BR-6 — Behandeling date constraint:** A behandeling date may be today or in the past.
Recording a behandeling for a future date is not permitted (it would be speculative clinical
documentation) [ASSUMPTION A-18].

**BR-7 — Behandelaar assignment:** A behandelaar can only be assigned to an afspraak if their
Clerk account is active and has the `behandelaar` role. Deactivated or role-stripped accounts
shall not appear in the behandelaar selection list.

**BR-8 — Convex as sole data gateway:** All reads and writes to patient, afspraak, and
behandeling data shall go through Convex queries and mutations. No direct database access
from the Next.js frontend or any unauthenticated path.

**BR-9 — AVG/GDPR — data residency (production blocker):** For the POC, Convex Cloud
(AWS-based) is acceptable. Before any production use with real patient data, an EU data
residency strategy must be decided and implemented. This requirement is explicitly unresolved;
it is tracked as a production blocker, not an MVP deliverable.

**BR-10 — Test data:** Automated tests and Convex seed scripts shall use synthetic/anonymized
data only. No real patient-identifying data shall appear in test fixtures, commit history, or
CI logs.

**BR-11 — AVG sensitivity of BSN:** The BSN is a special-category identifier under Dutch law
(Wbp / AVG Art. 87; UAVG Art. 46). Its processing requires a legal basis (e.g., healthcare
provision). The following constraints apply in the MVP and must be tightened before production:
- The BSN shall not appear in Convex function logs, error messages, or CI output (see AC-7,
  BR-10). This no-log rule is independent of UI visibility and applies to all roles.
- BSN uniqueness is enforced: if a BSN already exists on another active patient, the system
  warns and requires explicit admin acknowledgment before saving (EH-4).
- **No additional field-level encryption** is applied to the BSN (or any other patient field)
  in the MVP. Convex Cloud's default at-rest encryption is accepted for the POC. **This is a
  confirmed decision (OQ-8 resolved v0.4).** Before any production use with real patient data,
  a formal legal-basis assessment and a field-level encryption strategy for BSN must be
  completed (tracked alongside the data-residency concern in BR-9).
- **No role-based UI masking** of the BSN is applied in the MVP. See BR-3 for the full
  visibility rule (OQ-23 resolved v0.4).

**BR-12 — Behandelsoort vocabulary integrity:** Both afspraken and behandelingen shall
reference `behandelsoortId` values from the shared `behandelsoort` reference collection
(FR-19). Free-text entry of behandelsoort is not permitted. The Convex mutation for creating
or editing an afspraak or behandeling shall validate that the provided `behandelsoortId`
exists and is active in the `behandelsoort` collection before persisting the record.

**BR-13 — Audit log mandatory and in-path:** Every Convex function that creates, edits,
finalizes, deactivates, or reads `patient` or `behandeling` data shall write an `audit_log`
entry (FR-20) as part of the same execution path. The audit write is not optional and shall
not be deferred to a background action. If the audit write cannot complete (e.g., due to a
Convex transaction error), the parent operation shall also fail — an action without an audit
record is not acceptable. Audit log entries are append-only; no mutation shall update or
delete them.

---

## Data Requirements

### Patient (`patient`)

| Field | Type | Constraints |
|---|---|---|
| `patientId` | System ID | Convex document `_id`; auto-assigned |
| `voornaam` | string | Required; max 100 chars |
| `tussenvoegsel` | string | Optional; max 20 chars |
| `achternaam` | string | Required; max 100 chars |
| `geboortedatum` | string (ISO 8601 date) | Required; must be past date |
| `geslacht` | enum | Required; see BR-1 |
| `bsn` | string | **Required**; 9 digits; validated by Elfproef (BR-2); AVG-sensitive (BR-11); unique across active patients (EH-4) |
| `email` | string | Optional; RFC 5322 format |
| `telefoonnummer` | string | Optional; free-text max 30 chars |
| `adres` | object | Optional; `straat`, `huisnummer`, `postcode`, `stad` |
| `notities` | string | Optional; max 2 000 chars |
| `actief` | boolean | Default `true`; set to `false` on deactivation (FR-5) |
| `_creationTime` | timestamp | Convex system field |

### Afspraak (`afspraak`)

| Field | Type | Constraints |
|---|---|---|
| `afspraakId` | System ID | Convex document `_id` |
| `patientId` | reference | FK to `patient`; required |
| `behandelaarId` | string | Clerk user ID of the assigned behandelaar; required |
| `startDatetime` | number (epoch ms) | Required; must be future at creation (BR-5) |
| `durationMinutes` | number | Required; positive integer |
| `behandelsoortId` | reference | Optional FK to `behandelsoort` collection; must be an active entry (BR-12) |
| `notities` | string | Optional; max 500 chars |
| `status` | enum | `gepland` | `bevestigd` | `voltooid` | `geannuleerd` |
| `cancellationReason` | string | Optional; max 500 chars; only when `geannuleerd` |
| `cancelledAt` | number (epoch ms) | Set when status transitions to `geannuleerd` |
| `_creationTime` | timestamp | Convex system field |

### Behandeling (`behandeling`)

| Field | Type | Constraints |
|---|---|---|
| `behandelingId` | System ID | Convex document `_id` |
| `patientId` | reference | FK to `patient`; required |
| `behandelaarId` | string | Clerk user ID of recording behandelaar; required |
| `treatmentDate` | string (ISO 8601 date) | Required; today or past (BR-6) |
| `startTime` | string (HH:MM) | Optional |
| `durationMinutes` | number | Optional; positive integer |
| `behandelsoortId` | reference | **Required** FK to `behandelsoort` collection; must be an active entry (BR-12) |
| `behandelverslag` | string | Required; no upper limit in MVP |
| `afspraakId` | reference | Optional FK to `afspraak` |
| `status` | enum | `concept` | `definitief` |
| `finalizedBy` | string | Clerk user ID; set on finalization |
| `finalizedAt` | number (epoch ms) | Set on finalization |
| `_creationTime` | timestamp | Convex system field |

### Behandelsoort (`behandelsoort`) — reference / controlled vocabulary

| Field | Type | Constraints |
|---|---|---|
| `behandelsoortId` | System ID | Convex document `_id`; auto-assigned |
| `naam` | string | Required; unique; max 150 chars; the display label shown in dropdowns |
| `actief` | boolean | Default `true`; set to `false` when deactivated by admin (FR-19) |
| `_creationTime` | timestamp | Convex system field |

> Both `afspraak.behandelsoortId` and `behandeling.behandelsoortId` are foreign keys into this
> collection. Deactivation (soft-delete) is the only supported removal path; hard deletion is
> blocked if any afspraak or behandeling references the entry [ASSUMPTION A-27].
>
> **Assumption A-28:** The `behandelsoort` vocabulary is managed exclusively by the `admin`
> role. No self-service addition by `balie` or `behandelaar` in MVP.

### Audit Log (`audit_log`)

| Field | Type | Constraints |
|---|---|---|
| `auditId` | System ID | Convex document `_id`; auto-assigned |
| `actorId` | string | Clerk user ID of the authenticated actor; required; never contains a display name or PII |
| `actorRole` | string | Role(s) of the actor at execution time (e.g., `behandelaar`, `balie`, `admin`); required |
| `action` | enum | Required; one of: `create`, `edit`, `view`, `deactivate`, `finalize` |
| `resourceType` | enum | Required; one of: `patient`, `afspraak`, `behandeling`, `behandelsoort` |
| `resourceId` | string | Convex document `_id` of the affected record; required |
| `timestamp` | number (epoch ms) | Server-side timestamp set by the Convex function; required |

> Entries are **append-only and immutable** (BR-13). No `update` or `delete` mutation shall
> target this collection. The payload contains no patient-identifying data — records are
> referenced by system ID only (FR-20). A queryable audit-log UI is not provided in the MVP;
> entries are accessible via the Convex dashboard.

---

## Dependencies & Integrations

| Dependency | Type | Notes |
|---|---|---|
| **Clerk** | Auth provider | Identity, roles, and JWT. Roles stored as Clerk public metadata and read by Convex via `ctx.auth.getUserIdentity()`. |
| **Convex Cloud** | Backend / DB | Reactive database, serverless functions. All data access goes through Convex queries/mutations. |
| **Vercel** | Frontend hosting | Deploys the Next.js app. Needs `NEXT_PUBLIC_CONVEX_URL` and Clerk env vars. |
| **Convex React client** | Frontend SDK | `useQuery` / `useMutation` hooks for reactive data binding in the Next.js app. |

No external integrations (e-mail notifications, SMS, external calendar systems, insurance
systems, FHIR/HL7) are in scope for the MVP. See Out of Scope.

---

## Edge Cases & Error Handling

**EH-1 — Patient not found:** A search that returns no results shall display a "no results
found" message. A BSN search that matches no active patient record shall return the same
"no results found" message without disclosing whether the BSN exists in any deactivated record
or in system internals (unauthenticated callers receive an auth error, not a not-found response).

**EH-2 — Concurrent edits:** If two users edit the same patient record simultaneously, the
last write wins in the MVP (Convex's default behavior). A conflict-resolution or optimistic-
lock strategy is not required for MVP. [ASSUMPTION A-24]

**EH-3 — Invalid afspraak transition:** A Convex mutation that receives an invalid status
transition (e.g., `voltooid` → `gepland`) shall throw a `ConvexError` with a descriptive
code (not a raw error string) that the frontend can map to a user-facing Dutch message.

**EH-4 — BSN uniqueness:** If a BSN is entered that already exists on another active patient,
the system shall warn the user and prevent saving [ASSUMPTION A-25]. This is a data-quality
safeguard, not a hard block (admin may override with explicit acknowledgment).

**EH-5 — Behandelaar deactivated after afspraak created:** If a behandelaar account is
deactivated after an afspraak is scheduled, existing afspraken remain valid. The deactivated
behandelaar is removed from the selection list for new afspraken but their historical records
remain intact.

**EH-6 — Session expiry:** If a Clerk session expires mid-flow, the Next.js app shall redirect
to the sign-in page and, after re-authentication, return the user to the page they were on
[ASSUMPTION A-26].

**EH-7 — Unauthorized Convex call:** Any Convex function that receives a request without a
valid Clerk identity token shall return a Convex auth error (not expose data). The frontend
shall surface a generic "access denied" message without revealing system internals.

---

## Out of Scope (MVP)

The following items are explicitly excluded from the MVP. They may be candidates for future
iterations.

| Item | Notes |
|---|---|
| Patient portal / patient login | Patients do not authenticate in MVP (Assumption A-3). |
| Email / SMS notifications | No automated messaging to patients or staff. |
| External calendar integration | No Google Calendar, Outlook, or iCal sync. |
| FHIR / HL7 interoperability | No healthcare interoperability standards integration. |
| Electronic prescriptions / referrals | Out of scope. |
| Billing / invoicing | Out of scope. |
| Multi-location / multi-clinic | Single clinic instance only. |
| Document / file attachments | No file uploads (scans, PDFs, images) on patient or behandeling records. |
| Audit log UI | A basic audit trail (FR-20, BR-13) is **in scope** for the MVP — create/edit/view/deactivate/finalize events are recorded in the `audit_log` collection. However, a queryable audit-log UI for staff is **not** in scope for the MVP; entries are accessible via the Convex dashboard only. A fuller AVG Art. 30 register (data-flow mapping, legal bases, retention periods, processor agreements) remains a production-phase concern. |
| Hard deletion of patient data (GDPR Art. 17) | Soft-deactivation only in MVP; a proper erasure process is a production concern. |
| Amendment / addendum workflow for finalized behandelingen | Finalized records are immutable; corrections require a new iteration. |
| Two-factor authentication configuration | Clerk handles 2FA; configuration thereof is admin-level and not a feature of the EPD application itself. |
| Reporting / analytics dashboard | No aggregate reporting in MVP. |

---

## Open Questions

The following questions should be answered by the product owner / stakeholders before the
FRD is baselined. Each question is labeled with the assumption that was made in the interim.

| ID | Domain | Question | Assumption made |
|---|---|---|---|
| OQ-1 | General | What is the current state of patient administration at the clinic? (paper, spreadsheet, legacy software?) This affects migration requirements (which are currently out of scope). | A-1: No migration scope in MVP. |
| OQ-2 | General | What is the target number of concurrent users? What is the expected total number of patient records at go-live? | A-10: Search results capped at 50; no explicit performance SLA stated beyond Convex defaults. |
| OQ-3 | General | Are there specific AVG/GDPR documentation requirements the clinic must meet for the POC (e.g., a verwerkersovereenkomst with Convex)? | BR-9: Data residency is an unresolved production blocker. |
| ~~OQ-4~~ | ~~Roles~~ | ~~Should a single user be able to hold both `behandelaar` and `balie` roles simultaneously? Or are they mutually exclusive?~~ | **RESOLVED (v0.4):** A user MAY hold multiple roles simultaneously. Effective permissions are the **union** of all held roles' permissions (additive model). A-2 confirmed. Role-permission matrix note and Actors/Roles section updated. |
| ~~OQ-5~~ | ~~Roles~~ | ~~Is there a need for a read-only viewer role (e.g., a practice manager or referring physician) who can view records but not create anything?~~ | **RESOLVED (v0.3):** No read-only viewer role. The three roles (`behandelaar`, `balie`, `admin`) are sufficient for the MVP. A-1 confirmed. |
| ~~OQ-6~~ | ~~Patiëntbeheer~~ | ~~Is the `geslacht` (gender) field required, or should it be optional? What controlled vocabulary should be used? Is `man/vrouw/overig/onbekend` correct for this clinic's context?~~ | **RESOLVED (v0.2):** Field is required; vocabulary is `man/vrouw/overig/onbekend`. BR-1 updated; A-6 confirmed. |
| ~~OQ-7~~ | ~~Patiëntbeheer~~ | ~~Is the BSN field required, optional, or entirely absent for this wellness clinic? (Many wellness clinics do not have official healthcare registration.)~~ | **RESOLVED (v0.2):** BSN is **required** on every patient. Elfproef validation enforced. A-7 superseded; BR-2, BR-11, FR-1, and patient data model updated. |
| ~~OQ-8~~ | ~~Patiëntbeheer~~ | ~~Should the BSN be stored encrypted at rest (beyond Convex's default encryption)? Is field-level encryption required for any patient fields in the POC?~~ | **RESOLVED (v0.4):** No additional field-level encryption for BSN or any patient field in the MVP. Convex Cloud's default at-rest encryption is accepted for the POC. Field-level encryption remains a production concern. BR-11 updated. |
| ~~OQ-9~~ | ~~Patiëntbeheer~~ | ~~Should `huisarts` (GP) be a structured reference (linked to a GP record) or free-text is sufficient?~~ | **RESOLVED (v0.3):** The `huisarts` field is **removed entirely** from the patient data model. No GP information is captured in the MVP. FR-1 and the patient data-model table updated; A-8 superseded. |
| OQ-10 | Patiëntbeheer | What is the intended soft-delete / deactivation policy? Should a deactivated patient be fully invisible to behandelaars (not just hidden from search), or should their historical records remain accessible? | A-11: Historical records remain accessible to all roles; deactivated patients are excluded from search and new afspraken. |
| ~~OQ-11~~ | ~~Afspraken~~ | ~~What are the clinic's operating hours? Should the agenda enforce that afspraken can only be scheduled within these hours?~~ | **RESOLVED (v0.3):** Operating hours are **not enforced**. Balie may schedule afspraken at any time. A-16 confirmed. |
| OQ-12 | Afspraken | What default appointment duration should be used? Is 30 minutes correct, or does the clinic use a different standard slot? | A-12: 30-minute default. |
| ~~OQ-13~~ | ~~Afspraken~~ | ~~Should `behandelsoort` for afspraken be a controlled vocabulary (dropdown), free-text, or both? Does it need to match or inform `behandelsoort` on the behandeling?~~ | **RESOLVED (v0.2):** Shared controlled vocabulary (dropdown), managed by admin. A single `behandelsoort` reference table serves both afspraken and behandelingen. FR-19, BR-12, A-27, A-28 added. A-13 superseded. |
| ~~OQ-14~~ | ~~Afspraken~~ | ~~Should the overlap/conflict detection be a hard block (cannot save) or a soft warning (can override)? Is double-booking ever intentional (e.g., group sessions)?~~ | **RESOLVED (v0.2):** Soft warning only — user can override. A-17 confirmed. FR-12 and AC-8 unchanged. |
| OQ-15 | Afspraken | Is a month view required for the agenda in MVP, or do day + week views suffice? | A-16: Day + week views only. |
| OQ-16 | Afspraken | Should the `balie` be notified (in-app) when a behandelaar marks an afspraak as voltooid? Or is status visibility via the calendar sufficient? | Not assumed; in-app notifications are out of scope for MVP. |
| OQ-17 | Behandelingen | Can a behandeling be back-dated (e.g., to record a treatment that happened yesterday but was not entered immediately)? What is the maximum back-date window? | A-18: Back-dating to any past date is allowed in MVP with no maximum window. |
| OQ-18 | Behandelingen | Are start time and duration on a behandeling required, or optional? | A-19: Both optional in MVP. |
| ~~OQ-19~~ | ~~Behandelingen~~ | ~~Should `behandelsoort` on the behandeling record be a controlled vocabulary shared with afspraken, or independent free-text?~~ | **RESOLVED (v0.2):** Covered by OQ-13 resolution — shared controlled vocabulary. A-20 superseded; FR-13 and behandeling data model updated. |
| OQ-20 | Behandelingen | Is the `behandelverslag` (clinical notes) field expected to support rich text (bold, lists, headings) or plain text in MVP? | Not assumed; plain text in MVP. |
| OQ-21 | Behandelingen | Should a behandelaar be able to see and edit another behandelaar's `concept` behandelingen, or is edit access strictly limited to the author? | A-21: Edit access limited to the author or admin. |
| OQ-22 | Behandelingen | Is pagination on the behandeling history list required, or is a simple list acceptable for the POC volume? What volume is expected (behandelingen per patient)? | A-22: Pagination at 20 items. |
| ~~OQ-23~~ | ~~Data / Privacy~~ | ~~Should the BSN be masked (partially hidden) in the UI for all roles, or only for `balie`?~~ | **RESOLVED (v0.4) — CHANGES PRIOR DECISIONS:** The BSN is **NOT masked for any role**. The full BSN is visible in the UI to every role permitted to view a patient (`behandelaar`, `balie`, `admin`). **This supersedes assumption A-23** (which masked BSN for `balie`) and changes BR-3 (masking rule and balie search restriction removed) and BR-11 (masking bullet removed). The balie role can now also search by BSN (FR-4 updated). The no-PII-in-logs rule (BR-10, AC-7, BR-11) is unaffected. |
| ~~OQ-24~~ | ~~Data / Privacy~~ | ~~Is there an explicit requirement for an audit trail (who viewed / edited which record, when)? AVG Art. 30 (records of processing activities) may require this before production.~~ | **RESOLVED (v0.3):** A basic audit trail is **in scope for the MVP** (change from previous assumption). FR-20 and BR-13 added; `audit_log` collection added to the data model. Audit entries record actor, action, resource type/id, and timestamp — no PII in payload. A queryable audit-log UI and a full Art. 30 register remain production-phase concerns. |
| ~~OQ-25~~ | ~~Data / Privacy~~ | ~~Should patient contact details (email, phone, address) also be masked or access-restricted for `balie` vs. `behandelaar`?~~ | **RESOLVED (v0.4):** Patient contact details (email, phone, address) are visible to **all roles** that can view a patient (`behandelaar`, `balie`, `admin`). No masking or role-based restriction applies. Prior assumption confirmed. |
| OQ-26 | UX | Is the session-expiry redirect behavior (EH-6) the desired UX, or should a session-timeout modal/warning be shown first? | A-26: Silent redirect assumed. |

---

## Appendix — Key Assumptions Summary

| ID | Assumption |
|---|---|
| A-1 | No data migration scope in MVP. Three roles (admin, behandelaar, balie) are sufficient. **Confirmed by stakeholder (OQ-5 resolved v0.3): no read-only viewer role required.** |
| A-2 | A single Clerk user may hold multiple roles simultaneously. Effective permissions are the union of all held roles (additive model). **Confirmed by stakeholder (OQ-4 resolved v0.4).** |
| A-3 | Patients do not authenticate; no patient-facing portal in MVP. |
| A-4 | Balie may read behandelingen but not create or edit them. |
| A-5 | Behandelaar sees only their own agenda unless also admin. |
| A-6 | `geslacht` is a required field with values: `man`, `vrouw`, `overig`, `onbekend`. **Confirmed by stakeholder (OQ-6 resolved v0.2).** |
| A-7 | ~~BSN is optional. Many wellness-clinic patients may not have a BSN on file.~~ **Superseded (OQ-7 resolved v0.2): BSN is required on every patient record.** |
| A-8 | ~~`huisarts` (GP) is free-text in MVP, not a structured reference.~~ **Superseded (OQ-9 resolved v0.3): the `huisarts` field is removed entirely from the patient data model. No GP information is captured.** |
| A-9 | Patient edits are partial: only changed fields need to be sent in the mutation payload. |
| A-10 | Patient search results are capped at 50 records per query. |
| A-11 | Patient deactivation is soft-delete only; hard deletion is a production-phase process. |
| A-12 | Default afspraak duration is 30 minutes. |
| A-13 | ~~`behandelsoort` on afspraken is free-text in MVP.~~ **Superseded (OQ-13 resolved v0.2): `behandelsoort` is a shared controlled vocabulary (reference table) for both afspraken and behandelingen.** |
| A-14 | Cancellation reason is optional free-text, max 500 characters. |
| A-15 | Agenda slots display patient as "First name + last-name initial" to minimize PII exposure in list views. |
| A-16 | Default agenda view is current week; day + week views only (no month view in MVP). No operating-hours enforcement — balie may schedule at any time. **Confirmed by stakeholder (OQ-11 resolved v0.3).** |
| A-17 | Afspraak conflict detection is a soft (non-blocking) warning. **Confirmed by stakeholder (OQ-14 resolved v0.2).** |
| A-18 | Behandelingen may be back-dated with no maximum window in MVP. |
| A-19 | Start time and duration on behandeling are optional. |
| A-20 | ~~`behandelsoort` on behandeling is free-text, independent from afspraken.~~ **Superseded (OQ-13/OQ-19 resolved v0.2): uses the same shared controlled vocabulary as afspraken.** |
| A-21 | Only the author behandelaar (or admin) can edit a `concept` behandeling. |
| A-22 | Behandeling history list paginates at 20 items. |
| A-23 | ~~BSN is masked for `balie`; visible to `behandelaar` and `admin`.~~ **Superseded (OQ-23 resolved v0.4):** The BSN is NOT masked for any role. The full BSN is visible in the UI to all roles permitted to view a patient. BR-3 and BR-11 updated accordingly. |
| A-24 | Concurrent edits use last-write-wins (no optimistic locking in MVP). |
| A-25 | Duplicate BSN entry triggers a warning; admin can override with explicit acknowledgment. |
| A-26 | Session expiry redirects silently to sign-in; return-URL is preserved. |
| A-27 | A `behandelsoort` entry that is referenced by any afspraak or behandeling cannot be hard-deleted; deactivation (soft-delete) is the only supported removal. |
| A-28 | The `behandelsoort` controlled vocabulary is managed exclusively by the `admin` role. No self-service addition by `balie` or `behandelaar` in MVP. |
