# UPSC Tracker

A server-rendered UPSC preparation tracker built with Node.js, Express, EJS, and PostgreSQL.

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env` and fill in your local database settings.
3. Run `npm ci`, then `npm run init-db`, then `npm start`.
4. Open http://localhost:3000.

Optional integrations (OpenAI, GNews, Gmail, and Google Calendar) need their corresponding credentials.

## Deploy to Vercel

This project uses Vercel's Express runtime, PostgreSQL-backed sessions, and a Vercel Cron endpoint. It needs an external PostgreSQL database; Vercel does not provide the app's database automatically.

1. **Protect the credentials first.** `.env` was tracked in the existing Git history. Rotate the credentials it contained before using them online. If you will make the GitHub repository public, remove `.env` from the complete Git history before pushing. Keep `.env` local; `.gitignore` excludes it.
2. **Choose a PostgreSQL provider** that allows connections from Vercel. Create a database and keep its TLS connection string (`DATABASE_URL`) private. The app creates its tables on the first request. Alternatively, run `npm run init-db` once with the production `DATABASE_URL` set.
3. **Check the book PDFs.** The current `public` assets total about 355 MB. Vercel Hobby allows up to 100 MB of static file uploads per deployment; this project will exceed that limit with all PDFs included. Keep the PDFs by using a plan that supports the required static-file size or move the PDFs to object storage/CDN and update their links before deploying. Review Vercel's [current limits](https://vercel.com/docs/limits).
4. Sign in at [Vercel](https://vercel.com), choose **Add New → Project**, and import the GitHub repository. Keep the GitHub repo private if you prefer; Vercel can deploy a connected private repository.
5. In **Project Settings → Environment Variables**, add:
   - `DATABASE_URL` — the production PostgreSQL connection string
   - `SESSION_SECRET` — a long, random value
   - `CRON_SECRET` — a different long, random value used to protect the daily email job
   - `NODE_ENV` = `production`
   - Optional: `OPENAI_API_KEY`, `GNEWS_API_KEY`, `EMAIL_USER`, `EMAIL_PASS`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
6. Deploy a Preview first. Check the build and runtime logs, then verify signup, login, the dashboard, and the CSS. Once those work, promote it by pushing to the production branch or using `vercel --prod`.
7. After the production URL is assigned, set the Google OAuth redirect URI to `https://YOUR-VERCEL-DOMAIN/auth/google/callback` in both Vercel and your Google OAuth client, then redeploy.

### Vercel limitations to account for

- Vercel serves files in `public/` from its CDN. The stylesheet is copied to `public/styles/main.css` for this reason.
- User uploaded notes are not persistent on Vercel's function filesystem. Configure object storage before relying on uploaded notes.
- The daily essay email job uses a Vercel Cron scheduled for 07:00 India Standard Time (01:30 UTC). Hobby cron timing is approximate, with hourly precision; see [Vercel Cron docs](https://vercel.com/docs/cron-jobs).
- The deployment's `DATABASE_URL`, session secret, cron secret, and integration keys must be set in Vercel, never committed to Git.
