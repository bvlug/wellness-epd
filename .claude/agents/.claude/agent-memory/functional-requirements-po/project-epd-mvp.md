---
name: project-epd-mvp
description: Core facts about the EPD MVP project — scope, stack, FRD status, and key open questions to resolve
metadata:
  type: project
---

The EPD (Elektronisch Patiëntendossier) is a wellness-clinic electronic patient record built
as a proof of concept. The repo is at C:\Dev\projects\work\stuff\likeahuman\dag2\.

**Why:** Proof-of-concept; handles real patient-shaped data so AVG/GDPR mindset applies from day one.

**How to apply:** Treat every requirement as if real patient data is in scope. Flag data-residency,
role-based access, and audit concerns even in POC context.

Stack: Next.js (App Router) + Convex (backend + DB) + Clerk (auth) + Vercel + TypeScript strict + pnpm + Vitest + Biome.

MVP scope — three domains:
1. Patiëntbeheer — create, search, view patient profiles (FR-1 to FR-5)
2. Afspraken / Agenda — schedule appointments, calendar view (FR-6 to FR-12)
3. Behandelingen — record treatments, treatment history (FR-13 to FR-18)

FRD (v0.2 draft) is at: C:\Dev\projects\work\stuff\likeahuman\dag2\docs\requirements\epd-mvp-frd.md
Created: 2026-06-02. Updated to v0.2: 2026-06-02. Status: pending stakeholder review.

Roles: admin, behandelaar, balie. Patients do NOT log in (no patient portal in MVP).
Admin also manages the behandelsoort controlled vocabulary (new in v0.2).

Key production blockers (not MVP deliverables):
- Data residency: Convex Cloud is AWS-based; EU data residency strategy needed before production with real patient data.
- Hard deletion (GDPR Art. 17 right to erasure): only soft-deactivation in MVP.
- Audit log UI: no queryable audit log in MVP.
- BSN field-level encryption: now required field (AVG-sensitive); field-level encryption deferred to production (OQ-8).

Confirmed stakeholder decisions (v0.2, all previously OQs):
- BSN is REQUIRED on every patient (Elfproef validation, AVG-sensitive per BR-11). A-7 superseded.
- geslacht is REQUIRED with vocabulary man/vrouw/overig/onbekend. A-6 confirmed.
- behandelsoort is a SHARED CONTROLLED VOCABULARY (Convex `behandelsoort` reference collection) used by both afspraken and behandelingen. Admin manages. FR-19 added. A-13/A-20 superseded.
- Afspraak overlap detection is SOFT WARNING (non-blocking). A-17 confirmed.

MVP domains now cover FR-1 to FR-19 (FR-19 added for behandelsoort vocabulary management).
21 open questions remain (OQ-1–5, 8–12, 15–18, 20–26). 28 assumptions total (A-1 to A-28).

Issue tracking: GitHub Issues. Epics/stories go there after FRD approval.
Downstream agent: agile-epic-story-writer takes approved FRD and produces sprint-ready stories.
