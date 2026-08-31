# Volunteer Hours Portal

An authenticated portal where team members sign in with Google, submit
evidence-backed volunteer-hour requests, and download verification letters for
their school. Administrators review registrations and requests, correct
mistakes through adjustments, and manage roles and permissions.

Built with TanStack Start (TanStack Router + TanStack Query), Postgres via
Drizzle, and deployed to Vercel.

## How it works

**Signing in.** Google is the only sign-in method, and any verified Google
account is accepted — school Workspace accounts included. Signing in does not
grant access to anything; it only establishes identity.

**Becoming a member.** The home page is sign-in only. After Google confirms
the account we look for a matching member (Google subject, then email). A
match goes to the pages their role allows. No match goes to `/register` to
submit first name, last name, Discord handle, and an optional phone number.
The application sits in `pending` until an administrator decides. A declined
applicant may submit again. A `suspended` member keeps their history but loses
access.

**Logging hours.** Approved members submit their own requests with a service
date, an activity description, hours, notes, and up to five photos. Photos are
stored privately and are only ever served through an authorised route.

**Review.** Administrators work from a single inbox at `/admin` with tabs for
pending requests and pending applications. On the request page they see the
evidence, any near-duplicate submissions from the same member, and can approve
(optionally for fewer hours than requested), decline, or ask for changes.
Administrators cannot review their own requests.

**The record.** Approving a request writes an immutable ledger entry. Nothing
is ever edited after the fact: corrections are separate adjustment entries with
a required reason, so the history stays auditable. Approval emails the member
and issues a verification certificate.

**Verification.** Every certificate carries a unique verification ID. A school
can confirm it at `/verify/<id>` without an account — the public page shows the
member name, the hours, the issuing organisation, and the date, and nothing
else.

## Getting started

Requirements: Node 20+. Local development uses an in-process database
(`DATABASE_URL=pglite:.data/pglite`) so you do not need to install Postgres.

```bash
npm install
cp .env.example .env    # then fill in Google OAuth values
npm run db:generate     # only after changing src/server/db/schema.ts
npm run dev
```

### Google OAuth credentials

In the [Google Cloud console](https://console.cloud.google.com/apis/credentials)
create an OAuth client of type **Web application** and add an authorised
redirect URI of exactly:

```
http://localhost:3000/api/auth/google/callback
```

Add the production equivalent (`https://your-app.vercel.app/api/auth/google/callback`)
before deploying. Copy the client ID and secret into `.env`.

### The first administrator

There is no seed script, because a seeded admin account is a credential nobody
rotates. Instead, put your own Google address in `BOOTSTRAP_ADMIN_EMAILS` and
sign in — the account is created as an approved administrator. Remove the
variable once real administrators exist; it is only consulted when an account
signs in for the first time.

### Storage and email in development

The defaults (`STORAGE_DRIVER=local`, `EMAIL_DRIVER=console`) need no external
services: photos are written under `.data/uploads` and emails are printed to
the server log. Switch to `s3` and `resend` for production.

## Deploying to Vercel

The Nitro plugin and `vercel.json` already select the TanStack Start preset.
Vercel will detect the framework — you do not need a custom build command.

### 1. Put the project on GitHub

This folder is not a git repository yet. From the project root:

```bash
git init
git add .
git commit -m "Initial volunteer hours portal"
```

Create a GitHub repo and push it, then [import that repo in Vercel](https://vercel.com/new).

### 2. Create a Postgres database

Vercel’s filesystem is ephemeral, so use a hosted Postgres (Neon, Supabase, or
Vercel Postgres). Copy the connection string into `DATABASE_URL`, then run
migrations against it once:

```bash
DATABASE_URL='postgres://…' npm run db:migrate
```

### 3. Set environment variables in Vercel

Project → Settings → Environment Variables. At minimum:

| Variable | What to put |
| --- | --- |
| `SESSION_SECRET` | A long random string. Generate with `node -e "console.log(crypto.randomBytes(32).toString('base64url'))"` |
| `DATABASE_URL` | The hosted Postgres URL |
| `GOOGLE_CLIENT_ID` | From the Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | From the same client |
| `APP_ORIGIN` | `https://your-app.vercel.app` (or your custom domain) |
| `BOOTSTRAP_ADMIN_EMAILS` | Your Google address, so the first sign-in is an admin |
| `STORAGE_DRIVER` | `s3` — the local disk driver does not persist on Vercel |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | A **private** bucket (Cloudflare R2 works; set `S3_ENDPOINT` too) |
| `EMAIL_DRIVER` | `resend` once you want real mail; `console` only logs |
| `RESEND_API_KEY`, `EMAIL_FROM` | Required when `EMAIL_DRIVER=resend` |

### 4. Google OAuth redirect

In the Google Cloud console, add this authorised redirect URI (plus localhost
for local work):

```
https://your-app.vercel.app/api/auth/google/callback
```

Redeploy after saving the variables.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3000 |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run test` | Full test suite |
| `npm run db:generate` | Generate a migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |

## Permissions

Roles are named bundles of capabilities rather than hardcoded checks, so a new
role — a reviewer who can approve hours but not manage people, say — is created
in the UI at `/admin/roles` without a code change. `admin` and `user` are
seeded and cannot be deleted, and the system refuses to remove or suspend the
last remaining administrator.

Every capability is enforced in the server function that does the work, not
only in the route guard that hides the link. `tests/authorization.test.ts`
asserts that every server function either composes an authorisation middleware
or is on a short, deliberate list of public endpoints.

## Testing

```bash
npm run test
```

Tests run against a real Postgres engine in-process (PGlite), with in-memory
email and storage drivers, so workflows are exercised end to end rather than
mocked. `tests/workflow.test.ts` covers first sign-in, resubmission after a
decline, approval, suspension, the five-photo limit, duplicate detection,
partial awards, adjustments, role enforcement, session revocation on role
change, and notification delivery and failure handling.

## Project layout

```
src/
  routes/            File-based routes; _app/* requires a session
    api/             OAuth callback, attachment and certificate downloads
  server/
    functions/       Server functions, each wrapped in an auth middleware
    services/        Business logic and transactions
    db/              Drizzle schema and connection
    auth/            Google OAuth, sessions, viewer loading
    storage/         Local and S3 drivers for evidence photos
    email/           Drivers and templates
    pdf/             Certificate rendering
  lib/               Code shared by client and server (permissions, validation)
tests/
```
