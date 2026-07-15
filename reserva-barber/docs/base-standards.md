---
description: >
  Base development rules and guidelines for the "Reserva Barber" project,
  following the Spec-Driven Development (SDD) paradigm. Applicable to all AI
  coding agents (Claude, Cursor, Codex, Gemini, etc.) and every human
  contributor. This document is the entry point and must be understandable with
  zero other context.
alwaysApply: true
---

# Base Development Standards
## Reserva Barber — Spec-Driven Development Constitution

> **Project in one paragraph:** Reserva Barber is a web application for barbershop
> appointment booking. A single **owner** administers one or more **locations**,
> each staffed by one or more **barbers**, entirely from a private **dashboard**.
> The owner shares a **public link**; clicking it renders the **booking flow**
> where guest clients pick a location, service, barber and time slot, and pay a
> mandatory **deposit** (via Mercado Pago or bank transfer with manual receipt
> approval) to confirm the appointment.

---

## 1. Core Principles

> ✅ **Universal — preserve. These apply to every task in this project.**

- **Small tasks, one at a time**: Always work in incremental steps. Never advance more than one step without verification.
- **Test-Driven Development (TDD)**: Start with failing tests for any new functionality, according to task specifications.
- **Type Safety**: All code must be fully and explicitly typed. This project is **TypeScript-first** — no implicit `any`, no untyped module boundaries.
- **Clear Naming**: Use clear, descriptive, intention-revealing names for all variables, functions, classes, and modules.
- **Incremental Changes**: Prefer small, focused changes over large, complex modifications. Each change should be independently verifiable.
- **Question Assumptions**: Always surface and challenge assumptions before acting on them. Make implicit decisions explicit.
- **Pattern Detection**: Identify and highlight repeated code patterns. Consolidate duplication before it becomes structural.

---

## 2. Language Standards

> ✅ **Universal — preserve.**

- **English Only**: All technical artifacts must use English without exception, including:
  - Code: variables, functions, classes, comments, error messages, log messages
  - Documentation: READMEs, guides, API docs, architecture decision records, these SDD documents
  - Data schemas and database object names (tables, columns, enums)
  - Configuration files and scripts
  - Git commit messages
  - Test names and descriptions
- **User-facing copy** (the dashboard UI and the public booking flow) is presented to end users in **Spanish (es-AR)**, since the target market is Argentine barbershops. Keep user-facing strings isolated (see `frontend-standards.md`) so the codebase stays English while the product speaks Spanish.

---

## 3. Specific Standards

> ✅ **Preserve this section structure.** These are the SDD constitution documents for this project.

For detailed standards specific to different areas of the project, refer to:

- [Project Context](./project-context.md) — the clarified project brief and stack decisions (source of truth for scope)
- [Data Model](./data-model.md) — entities, relationships, and the ER diagram
- [Backend Standards](./backend-standards.md) — API development, DDD layering, database patterns, testing, security
- [Frontend Standards](./frontend-standards.md) — UI component conventions, UX guidelines, and frontend architecture
- Documentation Standards — *to be created* (technical documentation structure and maintenance guidelines)

---

## 4. Project Scope Guardrails

> ⚠ **[ADAPT — project-specific]** These constraints define what is and is not in scope for the current version. Agents must not implement beyond them without a spec update.

- **Single administrative role**: the **Owner**. There is **no** login or panel for barbers, and **no** "partner barbers sharing a location" model in this version.
- **Guest clients**: clients booking through the public link do **not** have accounts. They are identified by name, email and phone, and cancel via a tokenized email link.
- **Multi-location, single owner**: one owner manages several locations; **each barber belongs to exactly one location**.
- **Shared payment configuration**: a single Mercado Pago account and a single bank transfer destination (CBU/CVU/alias) apply to all locations.
- **Mandatory deposit** confirms every booking. Out of scope for the MVP: WhatsApp/SMS notifications, refunds automation.

---

## 5. Tooling & AI Workflow

> ⚠ **[ADAPT — project-specific]** This project is built with a 3-stage SDD pipeline.

- **SDD pipeline**: `stack-advisor` → `sdd-docs-generator` → `roadmap-planner`. This document set is the output of stage 2. The prioritized user-story roadmap is produced by stage 3.
- **Planning vs. implementation**: use a high-reasoning model for planning/spec work (roadmap, data-model changes, architecture decisions); a standard model is acceptable for mechanical implementation once the spec is settled.
- **Source of truth**: the four documents in `docs/` (`base-standards`, `data-model`, `backend-standards`, `frontend-standards`) plus `project-context.md`. Code must conform to them, not the other way around.

---

## 6. Artifact Organization

> ⚠ **[ADAPT — project-specific]**

- All SDD constitution documents live in `docs/` at the project root. This is the canonical location.
- When an entity, feature name, or convention is renamed, update it across **all four** documents in the same change — the docs must never disagree with each other (see Consistency Rules below).

---

## 7. Spec-First Change Policy

> ✅ **Universal to SDD — preserve.**

When a new fix or change request appears **after a spec has been applied but before it has been archived/closed**, agents must treat it as a **spec update first**, not as an informal quick fix. Documentation is the source of truth.

**Required order:**

1. Update the affected spec artifacts (scenarios, requirements, task list, and — if entities change — `data-model.md`) to reflect the new request. Do not add tasks as "bugfixes"; integrate them into the original design in the appropriate section.
2. Regenerate any derived artifacts affected by the change before writing code.
3. Implement code **only after** all artifacts reflect the updated request.
4. Re-run verification against the updated artifacts before closing the spec.

> ⚠ Do not apply direct code-only fixes within an open spec window without first updating the spec artifacts. This violates the SDD contract regardless of how small the change appears to be.

---

## 8. Consistency Rules (cross-document)

> ✅ **Preserve.**

- Use the **exact same entity and feature names** across all four documents and in code. The canonical entity names are defined in `data-model.md` (e.g., `Owner`, `Location`, `Barber`, `Service`, `Booking`, `Client`, `TransferReceipt`, `PaymentConfig`).
- Every stack-specific claim (a pattern, a library, a convention) must trace back to the stack decisions in `project-context.md`. Do not introduce a technology that was not decided there: **Next.js (App Router) on Cloudflare, Supabase (PostgreSQL) + Prisma, Supabase Storage, Tailwind CSS + shadcn/ui, Recharts/Tremor, Mercado Pago, Resend**.
