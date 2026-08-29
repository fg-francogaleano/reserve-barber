---
description: >
  Frontend development standards, best practices, and conventions for Reserva Barber.
  The frontend is a Next.js (App Router) application in TypeScript, styled with Tailwind CSS
  and shadcn/ui. Dashboard charts are server-rendered SVG; Recharts/Tremor remain available but
  are not the default (see Charts). Covers both the private owner dashboard and the public guest
  booking flow.
globs: []
alwaysApply: true
---

# Frontend Project Standards and Best Practices
## Reserva Barber

> These practices ensure code consistency, maintainability, and an optimal development
> experience. Stack-agnostic principles are mandatory; stack-specific details are bound to
> the decisions in `project-context.md`. User-facing copy is in **Spanish (es-AR)**; all
> code, identifiers, and comments are in **English**.

---

## Table of Contents

- [Overview](#overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Coding Standards](#coding-standards)
- [UI/UX Standards](#uiux-standards)
- [Data Fetching & Mutations](#data-fetching--mutations)
- [Testing Standards](#testing-standards)
- [Configuration Standards](#configuration-standards)
- [Performance Best Practices](#performance-best-practices)
- [Development Workflow](#development-workflow)

---

## Overview

This document outlines the best practices, conventions, and standards for the **Reserva Barber**
frontend. The application has two surfaces built with the same framework:

1. **Owner dashboard** (private, authenticated): Inicio, Perfil, Calendario, Clientes, Estadísticas, Servicios, Transferencia, Mercado Pago.
2. **Public booking flow** (guest, unauthenticated): served at `/b/[slug]`, renders the public profile and the step-by-step reservation.

---

## Technology Stack

### Core Technologies
- **UI framework:** **Next.js (App Router)** with **React** — Server Components by default, Client Components where interactivity is needed.
- **Language:** **TypeScript** with `strict` mode.
- **Build tool / runtime:** Next.js build, deployed to **Cloudflare** via `@opennextjs/cloudflare`.
- **Routing:** Next.js file-system routing (App Router). No client-side router library needed.

### UI Framework
- **CSS framework:** **Tailwind CSS** — utility-first styling and responsive layout.
- **Component library:** **shadcn/ui** — accessible, unstyled-by-default components copied into the repo (`src/components/ui/`) and owned by the project.
- **Icons:** **lucide-react** (ships with shadcn/ui).
- **Charts:** **Recharts** (and/or **Tremor**) for the Estadísticas dashboard (income evolution, payment methods, hourly distribution).
  > **Neither is installed, and the first two charts shipped without them (D6).** `/estadisticas`
  > carries a tested requirement that the page depend on **no client JavaScript**, and every
  > client-side charting library is disqualified by the same mechanism: its layout is computed by
  > measuring the browser, so it renders nothing on the server and different markup on hydration —
  > on a surface displaying money, which is the exact failure the page's "all `Intl` on the server"
  > rule exists to prevent. Behind `next/dynamic({ ssr: false })` it would still need the accessible
  > data table written as the real content, so it buys nothing the hand-rolled SVG does not and
  > costs ~90–110 KiB gzip for it.
  >
  > **What shipped instead:** inline SVG drawn by Server Components, from pure value-to-geometry
  > functions with no DOM access. See `IncomeChart.tsx` and `PaymentMethodsChart.tsx`.
  >
  > These libraries remain **available to the project** — this is not a ban. They stopped being the
  > default *for this page*. What would bring one back is genuine interaction (hover tooltips, zoom,
  > brushing), or D7 arriving with chart shapes that are not bars. The repository port returns data
  > rather than markup, so swapping the renderer would touch neither the domain nor the SQL.
- **Date/calendar:** a shadcn/ui + `react-day-picker` calendar for date selection; a custom slot grid for barber availability.
  > **Neither has been installed, and two surfaces have now shipped without them.** The public flow's
  > date step (B3) is a strip of server-rendered links, and the owner's per-barber calendar (D3) is a
  > native `<input type="date">` inside a GET form. On both, a picker would have been the **only**
  > client component on a route that otherwise ships no JavaScript — trading the zero-JS property, and
  > Worker bundle against the size ceiling (T51), for a control the server-rendered version already
  > provides. Reach for `react-day-picker` when a surface genuinely needs month navigation or a range
  > selection; a single day, chosen from a bounded set, is not that surface.

### State Management & Data Flow
- **Local state:** React hooks (`useState`, `useReducer`).
- **Server state:** prefer **React Server Components** + Server Actions; use **TanStack Query** on the client only where live client-side caching/refetching is genuinely needed (e.g., polling pending transfer receipts).
- **Data fetching:** native `fetch` in Server Components / Route Handlers; Server Actions for mutations. No Axios.
- **Forms:** native `<form action={…}>` driven by a **Server Action**, with `useActionState` for returned state and `useFormStatus` for the pending state. Validation is a **Zod** schema on the server (see Form Handling below).

### Testing Framework
- **Unit / component:** **Vitest** + **React Testing Library**.
- **End-to-end:** **Playwright**.

### Development Tools
- **Linter:** ESLint (Next.js + `@typescript-eslint`).
- **Formatter:** Prettier (with `prettier-plugin-tailwindcss` for class ordering).
- **Type checker:** `tsc --noEmit`.

---

## Project Structure

> Next.js App Router conventions. Route groups separate the private dashboard from the public flow.

```
barber/
├── app/
│   ├── (dashboard)/                 # Private owner dashboard (authenticated)
│   │   ├── layout.tsx               # Dashboard shell (sidebar, auth guard)
│   │   ├── page.tsx                 # Inicio (summary stats + recent activity)
│   │   ├── sucursales/              # Locations: list, create, edit
│   │   │   ├── page.tsx
│   │   │   ├── nueva/page.tsx
│   │   │   └── [id]/editar/page.tsx
│   │   ├── barberos/                # Barbers: list (the card per barber), create, edit
│   │   │   ├── page.tsx
│   │   │   ├── nuevo/page.tsx
│   │   │   └── [id]/
│   │   │       ├── editar/page.tsx
│   │   │       ├── servicios/page.tsx
│   │   │       ├── horarios/page.tsx
│   │   │       ├── ausencias/page.tsx
│   │   │       └── calendario/page.tsx   # D3: that barber's day view
│   │   ├── servicios/              # Services: list, create, edit
│   │   │   ├── page.tsx
│   │   │   ├── nuevo/page.tsx
│   │   │   └── [id]/editar/page.tsx
│   │   ├── perfil/page.tsx
│   │   ├── clientes/page.tsx
│   │   ├── estadisticas/page.tsx
│   │   ├── transferencia/page.tsx
│   │   └── mercado-pago/page.tsx
│   ├── b/[slug]/                     # Public booking flow (guest)
│   │   ├── page.tsx                  # Public profile + "Reservar"
│   │   └── reservar/…                # Step-by-step booking
│   ├── api/                          # Route Handlers (see backend-standards.md)
│   └── layout.tsx                    # Root layout
├── src/
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives (button, card, dialog…)
│   │   ├── dashboard/                # Dashboard-specific composed components
│   │   └── booking/                  # Public booking-flow components
│   ├── hooks/                        # Reusable client hooks (useAvailability…)
│   ├── lib/                          # utils.ts (cn), formatters, client helpers
│   └── server/                       # Server-only domain/app/infra (see backend-standards.md)
├── public/                           # Static assets
├── tailwind.config.ts
├── components.json                   # shadcn/ui config
├── tsconfig.json
└── eslint.config.mjs
```

---

## Coding Standards

### Language and Naming Conventions

- **Components:** PascalCase — `BookingSummary`, `BarberCard`, `RecentBookingsTable`.
- **Variables & functions:** camelCase — `handleSubmit`, `fetchAvailability`.
- **Constants:** UPPER_SNAKE_CASE — `SLOT_GRANULARITY_MINUTES`, `MAX_UPLOAD_MB`.
- **Types / Interfaces:** PascalCase — `BookingDTO`, `BarberWithServices`.
- **File names:** PascalCase for components (`BarberCard.tsx`); Next.js special files lowercase (`page.tsx`, `layout.tsx`, `actions.ts`); utilities camelCase (`formatCurrency.ts`).
- **CSS / class utilities:** Tailwind utility classes; compose conditional classes with the `cn()` helper (`clsx` + `tailwind-merge`).
- **Custom hooks:** camelCase prefixed with `use` — `useAvailability`, `useBookingWizard`.
- **Language rule:** all identifiers, comments, and logs **in English**. User-facing strings in Spanish, kept out of logic (see UI/UX).

```tsx
// ✅ Good: Server Component by default, typed props, English identifiers
type BarberCardProps = {
  barber: BarberWithServices;
  onSelect: (barberId: string) => void;
};

export function BarberCard({ barber, onSelect }: BarberCardProps) {
  return (
    <button
      type="button"
      className="rounded-lg border p-4 text-left transition hover:border-primary"
      onClick={() => onSelect(barber.id)}
    >
      {/* content */}
    </button>
  );
}
```

**Error messages and logs (English):**

```tsx
catch (error) {
  console.error('Failed to fetch availability:', error);
  setError('No pudimos cargar los horarios disponibles. Intentá de nuevo.'); // user-facing: Spanish
}
```

### Component Conventions

- **Server Components by default.** Add `'use client'` only when a component needs state, effects, event handlers, or browser APIs. Push interactivity to small leaf Client Components; keep data-fetching in Server Components.
- **One component, one responsibility.** Compose pages from focused components.
- **Prefer functional components** with typed props. No class components.
- **shadcn/ui primitives** live in `src/components/ui/` and are extended by composition, not forked ad hoc.

```tsx
// 'use client' only where interactivity is required
'use client';
import { useState } from 'react';

type BookingStatus = 'PENDING_PAYMENT' | 'PENDING_APPROVAL' | 'CONFIRMED' | 'CANCELLED' | 'EXPIRED';
```

### State Management

- **Local state** (`useState`/`useReducer`) for component-scoped UI.
- **Server state** via Server Components + Server Actions; TanStack Query only where client caching/polling is required.
- **Always handle loading, success, and error states** for async operations.
- Extract reusable stateful logic into custom hooks (`useBookingWizard` for the multi-step flow).

```tsx
const [loading, setLoading] = useState(true);
const [error, setError] = useState('');
try {
  setLoading(true);
  const data = await fetchAvailability(barberId, serviceId, date);
} catch (err) {
  setError('No se pudieron cargar los horarios.'); // Spanish, user-facing
} finally {
  setLoading(false);
}
```

---

## UI/UX Standards

### UI Library Integration (Tailwind + shadcn/ui)

```tsx
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
```

**Rules:**
- Use shadcn/ui components (`Button`, `Card`, `Dialog`, `Table`, `Tabs`, `Select`…) instead of raw HTML where an equivalent exists.
- Style with Tailwind utilities and design tokens (theme colors, spacing) — avoid arbitrary magic-number values and one-off CSS files.
- Use `cn()` to merge conditional classes; let `prettier-plugin-tailwindcss` order them.
- **Charts:** on `/estadisticas`, charts are **server-rendered inline SVG** — no client charting library. That page's no-client-JavaScript requirement is tested, and a library that measures the browser cannot satisfy it (see the Charts note under Core Libraries). Keep the geometry as pure functions and give every chart a text equivalent carrying the identical numbers: a chart is an image to a screen reader, and colour is never the sole encoder of a distinction.
- **Responsive first:** the dashboard and booking flow must work on mobile — clients open the booking link primarily on phones.

### Internationalization / Copy

- All user-facing text is **Spanish (es-AR)**. Keep strings in a central location (constants or a lightweight dictionary), not scattered inline with logic, so copy can be reviewed and later translated.
- Format currency in ARS and dates in `es-AR` via `Intl.NumberFormat` / `Intl.DateTimeFormat`.
- **An email is user-facing copy that happens not to be rendered by React**, and its strings live in
  `copy.ts` under their own namespace like every other Spanish string — not inline in the module that
  composes the message. The message is built by a pure function taking a projection and returning
  subject, text and html; the copy it reads comes from the same dictionary a page would read, so the
  product's voice is reviewable in one file rather than in one file plus an adapter.
- **An appointment is formatted in the business timezone, never the runtime's and never the
  recipient's**, through the shared business-time module rather than a second `Intl` call written at
  the point of use. A second expression of a rule that reads a clock drifts from the first.

### Form Handling

**House pattern:** a native `<form action={serverAction}>` with uncontrolled shadcn/ui inputs. The client component calls `useActionState` to hold what the action returned (form-level error, field errors) and `useFormStatus` in a small child for the pending state. Validation lives in **one** place — a Zod schema executed inside the action — so the browser and the server can never disagree about what is valid.

Why this over React Hook Form: the form still submits before hydration (**but not with JavaScript disabled — see the note below and T44**), there is a single validation source instead of two that drift apart, and no extra dependency is carried for what are usually a handful of inputs. Reach for a client-side form library only when a form genuinely needs per-keystroke interactivity (cross-field live calculations, dynamic field arrays) — the multi-step booking wizard is the plausible candidate, not a two-field settings form.

- **Disable the submit button while submitting** to prevent double booking/payment. Note this state only exists after hydration; the server must remain the real guard against duplicate submissions.
- Surface field-level and form-level errors accessibly, and **preserve what the user typed** when a submission is rejected — a validation error that clears the form is worse than the error it reports.
- Infrastructure failures inside an action are returned as form state, never thrown: throwing reaches the route error boundary, which replaces the page and discards the user's input.

**A numeric or monetary field uses `type="text"` with `inputMode="decimal"` — never `type="number"`.** A number-typed control submits an **empty string** when the browser's own parser rejects what was typed, and an es-AR keyboard's `4500,50` is exactly such a value in Chrome. Three failures follow at once: the server reports a missing price for a price that was typed; the echo-back that preserves input on rejection has nothing to echo; and "missing" becomes indistinguishable from "malformed". `inputMode="decimal"` still raises the numeric keypad on touch devices, which was the only real benefit on offer.

For the same reason, no form control may carry `min`, `max`, `step`, or `pattern`. Each lets the browser block the submission with a message in the **browser's** locale, from a string that exists nowhere in the copy module — so the validation the specification describes would not be the validation the user meets, and the server-side rule would never run. `required` is retained: it never alters a value. Parsing and range checking are the server's job, and the server accepts both `.` and `,` as the decimal separator.

> ⚠ **The "with JavaScript disabled" half of this promise does not currently hold** — measured
> against a production build during PC2 (2026-08-14). Two causes, both above the level of any
> individual form: the `(dashboard)` segment's Suspense boundary stops client components rendering at
> all, and `useActionState` does not restore its returned state after a no-JavaScript POST, so a
> submission is accepted and nothing is reported back. See **T44**.
>
> The conventions below are still the right ones and are still required — they are what makes the
> promise *achievable* once T44 is decided, and they are what keeps forms working **before
> hydration**, which does hold. What must stop is writing "and with JavaScript disabled" as though it
> were true today.

**Select controls backed by another table must use a native `<select>`, not shadcn/Radix `Select`.** Radix's `Select` renders a button and a portalled listbox — it is not a form-associated control — so without a hidden mirror input and a client-side sync it submits nothing. A native `<select>` styled with the same ring/border tokens as `Input` preserves the house promise that the form submits correctly before hydration and with JavaScript disabled. The valid option set is always re-verified server-side at write time; what the browser renders is a UX affordance, not a security boundary.

```tsx
'use client';
const [state, formAction] = useActionState(createLocationAction, { error: null });

function SubmitButton() {
  const { pending } = useFormStatus(); // must live inside the <form>
  return <Button type="submit" disabled={pending}>{pending ? 'Guardando…' : 'Guardar'}</Button>;
}
```

### Navigation Patterns

- Use Next.js `<Link>` and `useRouter()` from `next/navigation` for all navigation — never manipulate `window.location` directly.
- The public booking flow is a **six-step wizard** (local → servicio → barbero → fecha → horario → datos), each a distinct step in the flow's step model, followed by payment (B5/B6). Keep step state in the URL search params so back/forward works and steps are shareable/restorable.
- Provide explicit back controls between steps.
- **The flow's own no-JavaScript answer does not use `useActionState`.** Its mutation is a Route Handler (see Data Fetching & Mutations above), so the pattern below — `useActionState` plus a form-level error returned as action state — has no role on this surface. The handler answers a browser submission with a redirect carrying an outcome code, and the receiving page renders that outcome from the server. This is what makes the house no-JS promise hold on the one surface a stranger reaches; see T44 in `tech-debt.md` for why the dashboard's ten `useActionState` forms are a separate, still-open problem.

### Accessibility

- `aria-label` on interactive elements lacking visible text; use semantic HTML (`<nav>`, `<main>`, `<button>`).
- Full keyboard navigation for the wizard and dashboard tables.
- `alt` text on meaningful images (barber avatars, profile/cover).
- Maintain WCAG AA color contrast (verify custom Tailwind theme colors).

---

## Data Fetching & Mutations

- **Reads:** fetch in Server Components (dashboard pages, public profile) so data is rendered on the server and secrets never reach the client. The Mercado Pago **Public Key** is the only payment credential exposed to the browser.
- **Mutations:** use **Server Actions** for dashboard operations (create service, assign barber, approve receipt). The public booking flow's mutations are **Route Handlers**, not Server Actions — see `backend-standards.md`'s API Design Standards, which states this as a hard rule rather than a preference: a Server Action is addressed by a build-time id, and a guest mid-checkout is exactly who must never meet one that Next.js no longer recognizes. Validate inputs with Zod inside the action or the handler.
- **Client-side live data:** use TanStack Query only for polling/interactive cases (e.g., the "Comprobantes pendientes" badge).
- **Never call the database or use the MP Access Token from a Client Component.** Client Components call Server Actions or Route Handlers.
- Handle errors on every request; show accessible feedback (toast/inline) in Spanish.

---

## Testing Standards

### Component / Unit (Vitest + React Testing Library)
- Test observable behavior, not implementation details. Query by role/label, not internal state.
- Use `data-testid` sparingly, only where role/label queries are insufficient.

### End-to-End (Playwright)
- Cover complete user workflows: the full **public booking + deposit** flow, and key dashboard flows (approve transfer receipt, create service and assign barber).
- Clear persistent state before each suite. Cover success and error paths (e.g., slot taken concurrently, rejected receipt).

```ts
// Playwright — illustrative
test('guest can book a slot and reach the deposit step', async ({ page }) => {
  await page.goto('/b/demo-barber');
  await page.getByRole('button', { name: 'Reservar' }).click();
  // select location → service → barber → date → slot → data → payment
  await expect(page.getByText('Seña')).toBeVisible();
});
```

### Test Organization
- Group scenarios with `describe`. Behavior-driven names: `should_[behavior]_when_[condition]`.
- Test success and error paths and edge cases (empty availability, DST boundaries). Keep tests independent.

---

## Configuration Standards

### Type Checker (`tsconfig.json`)

```jsonc
{
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```
- Strictest mode always on. Use the `@/*` path alias to avoid deep relative imports.

### Linter
- Extend `next/core-web-vitals` + `@typescript-eslint` recommended. Add Prettier + `prettier-plugin-tailwindcss`. Zero lint errors before commit.

### Environment Configuration
- Use environment variables for all environment-specific values. Client-exposed vars must be prefixed `NEXT_PUBLIC_` (e.g., `NEXT_PUBLIC_MP_PUBLIC_KEY`, `NEXT_PUBLIC_APP_URL`). **Never** prefix secrets with `NEXT_PUBLIC_`.
- Never hardcode hosts, ports, or secrets. Provide a `.env.example` documenting required variables without real values. Separate dev/staging/prod configs.

```ts
// playwright.config.ts — illustrative
export default defineConfig({
  use: { baseURL: process.env.APP_URL ?? 'http://localhost:3000' },
});
```

---

## Performance Best Practices

### Component Optimization
- Favor Server Components to ship less JS to the client. Lazy-load heavy client components (`next/dynamic`) where one is genuinely needed — **not** for the Estadísticas charts, which are Server Components rendering SVG and have no client bundle to defer.
- Memoize expensive client computations (`useMemo`, `useCallback`, `React.memo`) deliberately.
- Use `next/image` for profile/cover/avatars (served from Supabase Storage) for automatic optimization.

### Bundle Optimization
- Rely on Next.js tree-shaking and route-level code splitting. Keep Client Component boundaries small.
- Import icons and chart pieces granularly. Monitor bundle size in CI.

### API Efficiency
- Handle errors on every request. Cache infrequently-changing server data with Next.js caching/revalidation.
- Debounce user-driven fetches (e.g., availability re-query on date change). Use optimistic UI for quick dashboard toggles where safe.

---

## Development Workflow

### Git Workflow
- Short-lived feature branches (`feature/<short-description>`). English commit messages (Conventional Commits). Small, focused PRs. Code review before merge to main.

### Development Scripts

| Purpose | Command |
|---|---|
| Start dev server | `npm run dev` |
| Run unit/component tests | `npm test` |
| Run E2E tests | `npm run e2e` |
| Production build | `npm run build` |
| Preview on Cloudflare runtime | `npm run preview` |
| Type check | `npm run typecheck` |
| Lint / format | `npm run lint` / `npm run format` |
| Add a shadcn/ui component | `npx shadcn@latest add <component>` |

### Code Quality Gates
- Linter and type checker clean before commit. All unit and E2E tests pass before deployment. Monitor bundle size / Web Vitals each release.

---

> This document is the reference foundation for frontend code quality and consistency in
> Reserva Barber. Preserve the architectural principles; keep every stack-specific detail
> aligned with `project-context.md`, and use the domain vocabulary defined in `data-model.md`.
