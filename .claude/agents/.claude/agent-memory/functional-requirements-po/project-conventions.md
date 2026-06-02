---
name: project-conventions
description: EPD project conventions for requirement artifacts — language, terminology, document structure, file locations, and access rules
metadata:
  type: project
---

Source of truth: C:\Dev\projects\work\stuff\likeahuman\dag2\CLAUDE.md

**Artifact language policy:**
- Internal artifacts (FRDs, epics, user stories, commit messages, PR descriptions): English
- User-facing artifacts (end-user docs, release notes): Dutch
- Dutch domain terms are kept as ubiquitous language even in English documents: patient, afspraak, behandeling, behandelaar, balie, voornaam, achternaam, geboortedatum

**Requirement file location:** C:\Dev\projects\work\stuff\likeahuman\dag2\docs\requirements\
**Naming convention:** <domain>-<feature>-frd.md (e.g. epd-mvp-frd.md)
**FR identifier scheme:** FR-N globally across the whole document; domains are sections, not separate numbering namespaces.

**Key domain terminology:**
- patient — patient record
- afspraak (pl. afspraken) — appointment
- behandeling (pl. behandelingen) — treatment / clinical encounter
- behandelaar — practitioner / therapist
- balie — reception / front-desk staff
- behandelverslag — treatment notes / clinical narrative
- behandelsoort — type/kind of treatment
- BSN — Burgerservicenummer (Dutch citizen service number); Elfproef (11-proof) validation
- geslacht — gender

**Roles (Clerk):** admin, behandelaar, balie. Enforced inside Convex functions, never frontend-only.

**Convex is the sole data gateway:** No direct DB access; all reads/writes via Convex queries/mutations. Every Convex function touching patient data must authorize via ctx.auth.getUserIdentity().

**Privacy rules (AVG/GDPR):**
- Never log PII (names, BSN, behandelinhoud) in logs, fixtures, or commits
- Use synthetic/anonymized data in tests
- Data residency is an unresolved production blocker

**Candidate user stories:** In FRDs, write seed-level story titles only. Full elaboration (Gherkin, sizing) is the agile-epic-story-writer agent's job.
