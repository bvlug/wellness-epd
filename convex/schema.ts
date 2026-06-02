import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex data model — single source of truth for the database (Story F-3-S1).
 *
 * Every field is described with a Convex `v.*` validator (never a raw TypeScript
 * type), so the schema is both the runtime contract and the type source. Fields
 * that the FRD marks "Required" are non-optional validators; everything else is
 * wrapped in `v.optional(...)`. Convex auto-manages `_id` and `_creationTime`,
 * so the FRD's "System ID" / "Convex system field" rows are not redeclared here.
 *
 * Domain terms stay Dutch where the FRD uses them (patient, afspraak,
 * behandeling, behandelsoort); structural/audit fields are English.
 *
 * Trace: FRD docs/requirements/epd-mvp-frd.md "Data Requirements" + BR-1, BR-8,
 * BR-12, BR-13. See the PR for field-by-field interpretation notes.
 */

/**
 * Accepted `geslacht` values — system-managed controlled vocabulary (BR-1).
 * Free-text entry is not permitted; the enum is the only allowed input.
 */
export const GESLACHT_VALUES = ["man", "vrouw", "overig", "onbekend"] as const;

/** Afspraak status lifecycle (FR-11). */
export const AFSPRAAK_STATUS_VALUES = ["gepland", "bevestigd", "voltooid", "geannuleerd"] as const;

/** Behandeling status — concept (editable) vs definitief (finalized, FR-15/FR-16). */
export const BEHANDELING_STATUS_VALUES = ["concept", "definitief"] as const;

/** Audit actions recorded for patient/behandeling data access (FR-20). */
export const AUDIT_ACTION_VALUES = ["create", "edit", "view", "deactivate", "finalize"] as const;

/** Resource types an audit entry can reference (FR-20). */
export const AUDIT_RESOURCE_TYPE_VALUES = [
  "patient",
  "afspraak",
  "behandeling",
  "behandelsoort",
] as const;

const geslacht = v.union(...GESLACHT_VALUES.map((value) => v.literal(value)));
const afspraakStatus = v.union(...AFSPRAAK_STATUS_VALUES.map((value) => v.literal(value)));
const behandelingStatus = v.union(...BEHANDELING_STATUS_VALUES.map((value) => v.literal(value)));
const auditAction = v.union(...AUDIT_ACTION_VALUES.map((value) => v.literal(value)));
const auditResourceType = v.union(...AUDIT_RESOURCE_TYPE_VALUES.map((value) => v.literal(value)));

export default defineSchema({
  /**
   * Patient base record (FR-1..FR-5). `bsn` is required and AVG-sensitive
   * (BR-2, BR-11) — never logged. Format/Elfproef/uniqueness checks are enforced
   * in the create/edit mutations, not by the schema validator (which only fixes
   * presence and type). The `by_bsn` index backs exact-BSN search (FR-4) and the
   * active-uniqueness check (EH-4). The `by_achternaam` index backs the
   * prefix/partial last-name search (FR-4, Story P-2-S1): a case-normalized
   * achternaam range scan, so name search reads only the matching key range
   * rather than scanning the whole table.
   */
  patient: defineTable({
    voornaam: v.string(),
    tussenvoegsel: v.optional(v.string()),
    achternaam: v.string(),
    // ISO 8601 date (YYYY-MM-DD); "must be past" enforced in the mutation.
    geboortedatum: v.string(),
    geslacht,
    // 9-digit BSN; Elfproef + uniqueness enforced in the mutation (BR-2, EH-4).
    bsn: v.string(),
    email: v.optional(v.string()),
    telefoonnummer: v.optional(v.string()),
    adres: v.optional(
      v.object({
        straat: v.string(),
        huisnummer: v.string(),
        postcode: v.string(),
        stad: v.string(),
      }),
    ),
    notities: v.optional(v.string()),
    actief: v.boolean(),
  })
    .index("by_bsn", ["bsn"])
    .index("by_achternaam", ["achternaam"]),

  /**
   * Scheduled appointment (FR-6..FR-12). `behandelaarId` is a Clerk user id
   * (string), enabling later role-filtered "my agenda" queries. `behandelsoortId`
   * is an optional FK that must resolve to an active behandelsoort (BR-12) — that
   * referential check lives in the mutation. Indexes back the day/week agenda
   * (FR-9) and per-patient lookups.
   */
  afspraak: defineTable({
    patientId: v.id("patient"),
    behandelaarId: v.string(),
    startDatetime: v.number(),
    durationMinutes: v.number(),
    behandelsoortId: v.optional(v.id("behandelsoort")),
    notities: v.optional(v.string()),
    status: afspraakStatus,
    cancellationReason: v.optional(v.string()),
    cancelledAt: v.optional(v.number()),
  })
    .index("by_patient", ["patientId"])
    .index("by_behandelaar_and_start", ["behandelaarId", "startDatetime"])
    .index("by_start", ["startDatetime"])
    // Backs the A-27 referential-integrity check: before a behandelsoort may be
    // hard-deleted, the delete mutation looks up whether ANY afspraak references
    // it. The index makes "does any afspraak point at this behandelsoort?" a
    // bounded lookup instead of a full-table scan.
    .index("by_behandelsoort", ["behandelsoortId"]),

  /**
   * Recorded treatment (FR-13..FR-18). `behandelsoortId` is a required FK that
   * must be an active behandelsoort (BR-12). `status` gates editability: concept
   * is editable (FR-16), definitief is locked and carries finalize metadata
   * (FR-15). Indexes back per-patient history (FR-18) and the afspraak link.
   */
  behandeling: defineTable({
    patientId: v.id("patient"),
    behandelaarId: v.string(),
    // ISO 8601 date (YYYY-MM-DD); "today or past" enforced in the mutation (BR-6).
    treatmentDate: v.string(),
    startTime: v.optional(v.string()),
    durationMinutes: v.optional(v.number()),
    behandelsoortId: v.id("behandelsoort"),
    behandelverslag: v.string(),
    afspraakId: v.optional(v.id("afspraak")),
    status: behandelingStatus,
    finalizedBy: v.optional(v.string()),
    finalizedAt: v.optional(v.number()),
  })
    .index("by_patient", ["patientId"])
    .index("by_afspraak", ["afspraakId"])
    // Backs the A-27 referential-integrity check (see afspraak.by_behandelsoort):
    // the behandelsoort hard-delete mutation checks for any referencing
    // behandeling through this index.
    .index("by_behandelsoort", ["behandelsoortId"]),

  /**
   * Controlled vocabulary of treatment types (FR-19, BR-12), shared by afspraak
   * and behandeling. Soft-delete only via `actief = false`. `by_naam` backs the
   * uniqueness check and dropdown lookups.
   */
  behandelsoort: defineTable({
    naam: v.string(),
    actief: v.boolean(),
  }).index("by_naam", ["naam"]),

  /**
   * Append-only audit trail (FR-20, BR-13). Entries are immutable: mutations may
   * only INSERT here — no update/delete mutation targets this table. The payload
   * is PII-free; affected records are referenced by system id only. `by_resource`
   * backs dashboard lookups of a record's history.
   */
  audit_log: defineTable({
    actorId: v.string(),
    actorRole: v.string(),
    action: auditAction,
    resourceType: auditResourceType,
    resourceId: v.string(),
    timestamp: v.number(),
  }).index("by_resource", ["resourceType", "resourceId"]),
});
