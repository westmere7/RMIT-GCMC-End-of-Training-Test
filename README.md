# End-of-Training Assessment

A timed onboarding test for GCMC Creative Services. Each attempt draws 30 questions at random from a shared bank, with at least one from every category. The team edits the bank through the editor page.

- **Test:** `/`
- **Editor:** `/admin.html` (not linked anywhere; share the link with the team. There's no sign-in, so anyone with the link can edit)

Sign-in is a testing build: any email and any staff ID get in. The first time someone signs in, they're asked for their first name, and it's remembered for next time. The name rides on the meter's needle and appears in the results.

## Deploy (Vercel + Supabase)

1. **Supabase:** create a project. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates:
   - `assessment_config`: row `main` is the live question bank
   - `assessment_config_history`: every previous version of the bank
   - `assessment_people`: first names, keyed by email fingerprint
   - `assessment_results`: finished attempts (score, `by_category`, every answer)
   - views `assessment_leaderboard` (score, time, strongest and weakest category) and `assessment_category_scores` (one row per attempt per category)
   - `assessment_migrations`: which files in `supabase/migrations/` have been applied
   - Storage bucket `assessment-images`: question pictures (public to read, WebP only, 3 MB each)

   Row-level security is on with no policies, so only the server can touch the tables.
2. **Vercel:** import this GitHub repo. Framework preset **Other**, no build command, output directory left as is. Add these environment variables:
   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | Project Settings → API → Project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API → `service_role` key. Keep it server-side only. |
3. Deploy, then share `https://<your-project>.vercel.app/` for the test and `https://<your-project>.vercel.app/admin.html` for the editor.

**How the data flows:**
- Until someone saves in the editor, the site serves the bundled `data/questions.json`.
- The first save copies it into Supabase. From then on Supabase is the source of truth, and editing `data/questions.json` in git no longer changes the live test.
- Every save bumps a revision number. If two people edit at once, the second one to save is asked to load the latest version or overwrite it, so nobody's changes vanish silently.
- First names are saved straight away, from the sign-in page or the editor's People list. They're in their own table, so adding one never clashes with someone editing questions.
- Each finished attempt is stored in `assessment_results`. Check the `assessment_leaderboard` view in Supabase to see everyone's scores.

## Categories

- **Every question has a category.** Pick it in the editor. The category list itself is a setting: comma-separated, in display order.
- **Each attempt has at least 10 questions** (fewer only if the bank itself is smaller).
- **"Always in"** on a question puts it in every attempt. Those go in first, and still count towards category coverage and the critical share. If more are marked than an attempt holds, a random selection of them is used, and the editor says so.
- **The random draw takes at least one question from each category** whenever the number of questions per attempt is at least the number of categories. The rest are drawn at random.
- **Results break the score down by category**, with the strongest and weakest named.

## Question types

- **Single choice:** one correct option. Candidates see round keys and "Choose one answer".
- **Multi choice:** several correct options; candidates must pick exactly those. They see square tick boxes, a yellow "Select all that apply" badge and a running count.
- **Match pairs:** each row in the editor is one pair (Column A → Column B), 2 to 8 pairs. Candidates see Column A on the left and Column B (shuffled) on the right, and link each pair by clicking one item then its match, or dragging between them. Each link is drawn as a coloured line, with the same number on both ends; clicking a pair again undoes it. Every pair must be right for the mark. Stored as `"pairs": [{ "left": "...", "right": "..." }]`.
- **Image question:** either a picture with the question (with text options below it), or pictures as the options (no text allowed on them). "More than one correct" turns it into select-all-that-apply. Pictures are converted to WebP in the editor (longest side 1600 px for the question, 1000 px for options) and must come out under 3 MB; they're stored in Supabase Storage, and the question keeps only their links. Offline (`server.py`) they go to `data/images/`.
- **Fill in the blank:** the prompt has `___` where the gap goes; answers are typed.
- **Short answer:** a typed answer. For both typed types, capitals, accents, spaces and punctuation are ignored, and the first accepted answer is the one shown as correct.

**Preview:** every question has a Preview button (Alt+P) in the editor. It opens the real test page with that question, including unsaved edits. Answer it to check the marking; nothing is saved or sent.

## Critical questions

- **Tick "Critical"** on any question in the editor. The candidate sees it flagged in red, with the penalty.
- **Each attempt is about 15% critical questions** (7 of 45), changeable in Settings under "Critical questions per attempt". It never goes above the number of critical questions in the bank.
- **A wrong or skipped critical question loses extra marks**: 3 by default, changeable in Settings. The score is (correct − penalties) ÷ questions, never below 0%.
- **Results list the critical errors.** Each result row in Supabase also stores `criticalErrors`, `marks` and `percent`.

## Run it locally

Double-click `Start Test.bat`. It opens http://localhost:8765/.

- **With live data (recommended):**
  - copy `.env.example` to `.env`
  - paste the same `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` you gave Vercel
  - make sure Node is installed

  `Start Test.bat` then runs `dev-server.js`, which uses the same `api/*.js` functions as Vercel against the same database. Anything you see or save locally is live.
- **Auto-refresh:** with the dev server, open pages refresh by themselves when a file changes. CSS changes swap in without a reload. A test in progress survives a reload.
- **Offline:** without a `.env` or without Node, it falls back to `server.py` (Python), which reads and writes `data/questions.json` and keeps everything in local files.

## Database changes

Schema changes go in a new numbered file in `supabase/migrations/`, which is then applied to the live project. `schema.sql` is always the complete current state, for fresh installs. Applying a migration needs `SUPABASE_DB_URL` in `.env`; use the **session pooler** URI, because the direct `db.<ref>` host is IPv6-only.

## Files

- `index.html`, `assets/app.js`, `assets/meter.js`: the test
- `admin.html`, `assets/admin.js`: the editor
- `assets/common.js`: shared helpers (answer matching, categories, the random draw)
- `api/questions.js`, `api/results.js`, `api/people.js`, `api/images.js`, `api/_store.js`: Vercel functions that talk to Supabase
- `dev-server.js`: local server running those same functions, with auto-refresh
- `server.py`: offline local server, file-based
- `data/questions.json`: the seed question bank and settings
