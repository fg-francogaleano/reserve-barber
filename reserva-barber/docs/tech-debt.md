# Technical Debt & Deferred Work
## Reserva Barber

> Known work that was **deliberately deferred**, each with the reason and the signal that should
> bring it back. Anything not written down here does not exist — it becomes a surprise for whoever
> touches that code next.
>
> This is not a wish list. An entry earns its place by having a concrete trigger. When an item is
> done, delete it; when its trigger fires, it stops being debt and becomes work.

---

## Open

### T1 — Client-side recovery from a missing Server Action
**Status:** deferred · **Effort:** ~1–2 h · **Owner story:** none (cross-cutting)

Pinning `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` keeps Server Action ids stable across deploys, so the
`"Server action not found"` dead end should no longer occur in the normal workflow. Three cases remain
uncovered: **renaming an action, moving its file, or a build that ships without the key.** In any of
those, an already-open tab still meets an unrecoverable error screen.

The safety net is a client-side handler that recognises the error and reloads the page **once** —
turning a dead end into a flicker.

- **Where:** a `global-error.tsx` (the login page has no error boundary of its own today) plus the
  existing `app/(dashboard)/error.tsx`, sharing a tested predicate.
- **The hazard to design around:** a reload loop. If the error survives the reload, reloading again
  makes the app unusable — worse than the bug. Guard with a one-shot `sessionStorage` flag and cover
  the "already reloaded" path with a test.
- **Trigger:** any recurrence of `"Server action not found"` in production, or before shipping the
  public booking flow — whichever comes first.

### T2 — Password policy is documented but not enforced
**Status:** **needs a human** · **Effort:** ~2 min

`docs/data-model.md` §1 requires a 12-character minimum. That rule lives in Supabase, not in this
codebase, and **has not been applied yet**: Authentication → Policies → minimum password length.
Until then the provider's default (6) is what actually protects the only administrative account.

- **Trigger:** now. Nothing depends on it, which is exactly why it will be forgotten.

### T3 — Five UI behaviours implemented but never exercised
**Status:** deferred · **Effort:** ~15 min in a browser

Verified by neither a test nor a manual pass, because each needs a real browser:

- double-submit is prevented while the login is pending
- the error region is announced (`aria-live`) and receives focus
- the email survives a failed attempt while the password is cleared
- a failed login answers `200` with form state, never `401`

- **Trigger:** the next time the login page is touched for any reason.

### T4 — Owner email hardcoded in a committed migration
**Status:** **needs a decision** · **Effort:** ~0 (accept) or ~30 min (parameterise)

`prisma/migrations/*_add_owner_and_location_fk/migration.sql` contains the owner's real address, and
the repository is on GitHub. Impact is limited — the same address already appears as the author of
every commit — and changing it now needs a fresh migration because the row exists in production.

- **Trigger:** if the repository is public **and** the address should not be. Otherwise close this as
  accepted.

### T5 — Development still runs on Windows
**Status:** deferred · **Effort:** ~1 h

OpenNext states plainly that Windows is not fully supported, and this project has already paid for it
twice: builds fail without Developer Mode, and `patches/@opennextjs+cloudflare+1.20.1.patch` exists
solely to fix a Windows path-separator bug (`docs/s0-versions-decision.md`, findings 1–3). **A patched
dependency is a standing liability** — the next adapter upgrade may silently break it.

Moving development to WSL removes that entire class of problem and lets the patch be deleted. It also
matches how the code is actually built for production, which is Linux.

- **Trigger:** an `@opennextjs/cloudflare` upgrade, or the next Windows-only build failure.
- **Note:** the project must live in the Linux filesystem (`~/…`), not under `/mnt/c/…` — crossing
  filesystems makes installs and builds several times slower.

### T6 — Platform decision: Cloudflare vs Vercel
**Status:** **decided — stay on Cloudflare**, revisit on trigger

Evaluated on 2026-08-05 after repeated infrastructure friction. Staying, because the strongest argument
for migrating — deployment skew breaking Server Actions — turned out to be solvable on Cloudflare for
free, and because Cloudflare's free tier permits commercial use while Vercel's Hobby plan does not
(this app charges deposits, so Vercel would cost ~US$20/month, against a documented ~$0 budget).
Vercel Hobby is additionally unable to run story **B7**, whose cron must fire every few minutes.

Revisit if **any** of these happens:

- deployment skew recurs in production **with the key pinned**
- an adapter upgrade breaks the build and the patch no longer applies
- the Mercado Pago webhook flow hits a `workerd` limitation
- two consecutive stories spend more time on infrastructure than on product

That last one is the honest criterion: for a solo developer, velocity is the scarcest resource.

---

## Closed

_(none yet — move entries here with the date and how they were resolved, rather than deleting them,
when the reasoning stays useful.)_
