# End-of-Training Assessment

A timed, 30-question onboarding test for GCMC Creative Services, drawn at random from a shared question bank. The team edits the bank through a private editor link.

- **Test:** `/`
- **Editor:** `/admin.html?key=YOUR_ADMIN_KEY` (not linked anywhere; share the full link with the team)

Sign-in is a testing build: any email and any staff ID get in. Add people in the editor only so the test greets them by name.

## Deploy (Vercel + Supabase)

1. **Supabase:** create a project. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates:
   - `assessment_config`: the live question bank, one row
   - `assessment_config_history`: every previous version
   - `assessment_results`: finished attempts, plus the `assessment_leaderboard` view

   Row-level security is on with no policies, so only the server can touch the tables.
2. **Vercel:** import this GitHub repo. Framework preset **Other**, no build command, output directory left as is. Add these environment variables:
   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key. Keep it server-side only. |
   | `ADMIN_KEY` | Any long random string. It goes in the editor link. Leave it unset to let anyone with `/admin.html` save. |
3. Deploy, then share `https://<your-project>.vercel.app/` for the test and `https://<your-project>.vercel.app/admin.html?key=<ADMIN_KEY>` for the editor.

**How the data flows:**
- Until someone saves in the editor, the site serves the bundled `data/questions.json`.
- The first save copies it into Supabase. From then on Supabase is the source of truth, and editing `data/questions.json` in git no longer changes the live test.
- Every save bumps a revision number. If two people edit at once, the second one to save is asked to load the latest version or overwrite it, so nobody's changes vanish silently.
- Each finished attempt is stored in `assessment_results`. Check the `assessment_leaderboard` view in Supabase to see everyone's scores.

## Run it locally

Double-click `Start Test.bat` (needs Python). It opens http://localhost:8765/. The local server reads and writes `data/questions.json`, keeps backups in `data/backups/` and saves attempts to `data/results/`. Both folders are git-ignored.

## Files

- `index.html`, `assets/app.js`, `assets/meter.js`: the test
- `admin.html`, `assets/admin.js`: the editor
- `assets/common.js`: shared helpers (answer matching, loading)
- `api/questions.js`, `api/results.js`, `api/_store.js`: Vercel functions that talk to Supabase
- `server.py`: local server with the same API, file-based
- `data/questions.json`: the seed question bank and settings
