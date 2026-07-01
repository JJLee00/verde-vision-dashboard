# Verde Vision — Client Dashboard

Client-facing dashboard for [useverdevision.com](https://useverdevision.com). Clients sign in with email + password to view their projects and upload Excel files of plant estimates.

**Stack:** Next.js (App Router) · Tailwind CSS · Supabase (auth, Postgres, file storage) · Vercel

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the contents of [`supabase/schema.sql`](supabase/schema.sql). This creates the `projects` and `plant_estimates` tables, the private `estimates` storage bucket, and row-level security so each client only sees their own data.
3. In **Authentication → Users**, click **Add user** to create an account for each client (email + password). Send them their credentials.
4. To give a client a project, insert a row into `projects` with their user id as `client_id` (Table Editor → projects → Insert row).

### 2. Local development

```sh
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
# from Supabase → Project Settings → API

npm install
npm run dev
```

### 3. Deployment (Vercel)

1. Push this repo to GitHub and import it as a new Vercel project.
2. Add the two `NEXT_PUBLIC_SUPABASE_*` env vars in Vercel → Project → Settings → Environment Variables.
3. Add `dashboard.useverdevision.com` in Settings → Domains. Vercel will show a CNAME record — that record must be added in the Squarespace DNS settings for `useverdevision.com`.

## How uploads work

Clients pick an `.xlsx`/`.xls`/`.csv` file; the browser counts the rows (via SheetJS), uploads the file to the private `estimates` bucket under `{user_id}/{project_id}/`, and records it in `plant_estimates`. Storage policies restrict each client to their own folder.
