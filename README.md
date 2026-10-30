# Wevlo / AR APK BUILD — Responsive Web App + Real APK Build Worker

This package contains the uploaded builder UI, a real Gradle-based Android build service, Docker deployment files, and a Supabase schema starter.

## Included

- `index.html` — standalone frontend page. ZIP import/export uses normal browser downloads when served from a real website (not the ChatGPT artifact preview).
- Mobile / desktop responsive layout, plus a header selector for **Auto**, **Mobile mode**, and **Desktop mode**. Auto follows viewport width.
- `build-server/` — Express API that accepts the existing frontend's multipart `config` + `source` request, builds an Android WebView wrapper with Gradle, signs the APK with V1/V2, verifies the signature, and exposes status/download endpoints.
- `docker-compose.yml`, `.env.example` — container deployment starter.
- `supabase/schema.sql` — RLS-enabled starter tables for Supabase Auth profiles, projects, builds, payments, and settings.

## 1. Run the frontend

For a quick local test, run a static web server from this folder, for example:

```bash
python3 -m http.server 5173
```

Open `http://localhost:5173`. For production, serve `index.html` over HTTPS from your hosting provider. ZIP downloads and exports may be blocked in an embedded artifact preview; test from the hosted page.

## 2. Run the real APK build server

Requirements: Docker with at least 4 GB RAM available (8 GB recommended), and a public HTTPS domain for production.

```bash
cp .env.example .env
# Edit .env: PUBLIC_BASE_URL must be the build API's public origin/base,
# ALLOWED_ORIGINS must be the exact origin where index.html is hosted.
docker compose up -d --build
```

Check `http://localhost:8080/health`; it should return JSON with `ok: true`.

In the site, sign in with the admin account for your installation, open **Admin Panel → Settings → Build server endpoint**, and enter:

```text
https://build.example.com/api/build
```

Use the complete `/api/build` path. The frontend then POSTs the source ZIP/config, polls `/api/build/status/{id}`, and downloads the generated APK from the returned `downloadUrl`.

### What the worker builds

- Website URL builds (`source=url`): Android WebView wrapper that loads an HTTPS website.
- Project ZIP builds: HTML/CSS/JS assets packaged into an Android WebView app; ZIP must contain `index.html` at its root or one top-level project folder.
- Release APK is built with Gradle and signed/verified with V1 and V2 schemes. A new temporary signing key is generated for each job and deleted after signing.

**Signing-key warning:** because a temporary key is generated per build, reinstalling a later build over an earlier one will not work as an update, and Play Store updates require a stable signing key. For production release management, replace this with a protected, persistent keystore per app/user stored outside the build workspace, never exposed to the browser. Do not distribute this demo key policy as a long-term app-signing solution.

### Production security checklist

- Put the build server behind HTTPS and a reverse proxy with authentication/rate limits; do not expose an unrestricted build endpoint to the public internet.
- Set `ALLOWED_ORIGINS` to your exact frontend origin (not `*`). CORS is not authentication.
- Restrict outbound network access from build workers, apply CPU/memory/job quotas, and monitor disk use.
- APKs and build status are held in local worker storage and expire after `RETENTION_HOURS`.
- The build worker is a starter implementation. Test on your target Android versions before production deployment.

## 3. Supabase database setup

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Configure Supabase Auth providers and email verification.
4. Integrate the frontend auth/project/payment flows with Supabase Auth and RLS policies before using it for real customers.

**Important current limitation:** the uploaded frontend's existing sign-in, sample admin, project list, wallet, and payment UI still use browser `localStorage`. The supplied Supabase schema is a secure starting point, but the legacy frontend has not yet been migrated to Supabase Auth/database. Do not use its demo admin/login or local wallet/payment logic for real customers or real money. A production migration must replace those handlers and make payment approvals/admin role changes server-side.

## 4. API contract

- `GET /health`
- `POST /api/build` — multipart `config` JSON field and optional `source` ZIP file; returns `{ "id": "..." }`.
- `GET /api/build/status/:id` — returns `{state, step, logs, downloadUrl, size, error}`.
- `GET /api/build/download/:id` — streams the completed APK.

## Troubleshooting

- `Cannot reach the build server`: verify endpoint, HTTPS, DNS, firewall, reverse proxy, and allowed origin.
- `413` upload: raise `MAX_UPLOAD_MB` and proxy upload limit together.
- Gradle / SDK error: inspect `docker compose logs -f wevlo-build-server` and confirm the container has enough memory.
- ZIP missing `index.html`: ensure the source ZIP is a web project and `index.html` is at the root or one folder down.
