---
name: verify
description: Build and drive Reserva Barber to observe a change at runtime (HTTP surface). Use when verifying a diff, confirming a fix works, or validating before deploy.
---

# Verify — Reserva Barber

Surface is **HTTP**. Drive it with `curl` and read the response; there is no CLI or GUI.

## Handle

Two runtimes — a change can pass on Node and still fail on workerd, so prefer workerd:

```bash
npm run dev                       # Node,   http://localhost:3000  (fast loop)
npx opennextjs-cloudflare build   # then:
npx wrangler dev                  # workerd, http://127.0.0.1:8787 (production runtime)
```

Deployed: `https://reserva-barber.franco-galeano.workers.dev`

**Before trusting a preview**, kill stale ones — an old `workerd` holding 8787 will silently
serve the previous build and you will verify the wrong code:

```bash
taskkill //IM workerd.exe //F      # Windows/Git Bash
netstat -ano | grep 8787           # confirm free
```

Rebuild needs `.open-next` free: stop wrangler first, or `rm -rf .open-next` fails with
`Device or resource busy`.

## Gotchas

- **Git Bash mangles paths.** `curl --data-urlencode 'next=/servicios'` silently becomes
  `C:/Program Files/Git/servicios`. Always `export MSYS_NO_PATHCONV=1` before probing any
  value that starts with `/`, or you will report shell artifacts as app behavior.
- **Server Actions (login/logout submit) are not curl-driveable** — React encodes them with
  runtime action IDs. Everything else (guards, redirects, renders, cookie handling) is.
  The authenticated flow needs a browser and the owner's password.
- `next dev` warns about multiple lockfiles and deprecated `middleware`. Both are known and
  harmless — see `docs/s0-versions-decision.md`.
- **Login only works over `localhost` / `127.0.0.1`.** Session cookies are set `Secure`, and browsers
  treat only those hosts as trustworthy over plain HTTP. Opening the LAN address `next dev` advertises
  (e.g. `http://192.168.1.43:3000`, handy for testing on a phone) leaves the cookie unstored and the
  login silently loops back to the form. Use a tunnel with HTTPS instead.

## Flows worth driving

```bash
export MSYS_NO_PATHCONV=1
B=http://127.0.0.1:8787

curl -s -D - -o /dev/null "$B/"                    # → 307 /login?next=%2F
curl -s -D - -o /dev/null "$B/cualquier-ruta"      # → 307 (guard is deny-by-default)
curl -s "$B/login" | grep -oE "Iniciar sesión"     # → renders es-AR copy
curl -s -o /dev/null -w "%{http_code}" "$B/favicon.ico"   # → 200, assets skip the guard

# Session handling: a corrupt cookie must fail closed (307), never 500
curl -s -D - -o /dev/null -H "Cookie: sb-wosyrupjjswipckrsjzh-auth-token=garbage" "$B/"
```

Watch `wrangler dev` output while driving — structured JSON error logs surface there.
Response times should be well under 1s; ~10s means a hung DB query (see finding 5 in
`docs/s0-versions-decision.md` — never cache the Prisma client at module scope).

## Database

`mcp__supabase__execute_sql` reads the live DB. To exercise a constraint without leaving
rows behind, wrap the insert in a `DO $$ ... EXCEPTION WHEN ... $$` block — it rolls back
to the savepoint automatically.
