This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Database migrations

Schema changes live as timestamped SQL files in `supabase/migrations/`, applied via the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)
(already a project dependency — invoke it with `npx supabase` or the `npm run db:*` scripts
below).

One-time setup, per environment you deploy to:

```bash
npm run db:link -- --project-ref <your-project-ref>
```

To apply pending migrations to that linked project:

```bash
npm run db:push
```

To create a new migration:

```bash
npm run db:migration:new <name>
```

This creates an empty `supabase/migrations/<timestamp>_<name>.sql` file — write the schema
change there, then `npm run db:push` it. Never hand-edit a migration that has already been
pushed to a shared environment; add a new one instead.

### Migrations on startup (Render)

`npm start` runs the `prestart` hook first, which applies any pending migrations via
`scripts/run-migrations.mjs` before `next start` serves traffic. Render runs the app as a
single long-lived process, so this happens once per deploy.

It is driven by one environment variable, set in the Render dashboard:

| Variable | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string from **Project Settings → Database → Connection string → URI** |

Notes:

- Use the **direct** connection (`db.<ref>.supabase.co:5432`), not the transaction-mode
  pooler — migrations run DDL in a transaction and the pooler will not handle it correctly.
- The password must be **percent-encoded** in the URI (the CLI requires this), so a `@` in
  the password becomes `%40`.
- This is a privileged credential and is deliberately separate from the app's own
  `NEXT_PUBLIC_SUPABASE_*` vars — those are an anon key and cannot run DDL. Keep it out of
  any `NEXT_PUBLIC_` variable, which would ship it to the browser.
- Render's build must install devDependencies (the Supabase CLI is one), e.g.
  `npm ci --include=dev && npm run build`.

Behaviour:

- **Unset `SUPABASE_DB_URL`** — migrations are skipped with a warning and the app boots.
  This keeps a plain local `npm start` working.
- **Migration fails** — startup is aborted with a non-zero exit, so the deploy fails rather
  than serving requests against an unexpected schema.

To dry-run the same step locally without starting the server:

```bash
SUPABASE_DB_URL=<uri> npm run db:migrate
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
