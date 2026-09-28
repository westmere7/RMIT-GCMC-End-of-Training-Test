# End-of-Training Assessment

A timed onboarding test for GCMC Creative Services. Each attempt draws 30 questions at random from a shared bank, with at least one from every category. The team edits the bank through the editor page.

- **Test:** `/`
- **Editor:** `/admin.html#key=…`, a private link (see below). Without its key the editor and its save endpoint refuse access.
- **Send in a question:** `/contribute.html?t=…`, one private link per team member, made in the editor's Team tab.
- **Play along:** `/join?r=CODE` (the QR code on the taker's briefing screen), or `/join` and type the room code.

Sign-in is a testing build: any email and any staff ID get in. The first time someone signs in, they're asked for their first name, and it's remembered for next time. The name rides on the meter's needle and appears in the results.

## Deploy (Vercel + Supabase)

1. **Supabase:** create a project. In **SQL Editor**, run [`supabase/schema.sql`](supabase/schema.sql). It creates:
   - `assessment_config`: row `main` is the live question bank
   - `assessment_config_history`: every previous version of the bank
   - `assessment_people`: first names, keyed by email fingerprint
   - `assessment_results`: finished attempts (score, `by_category`, every answer)
   - views `assessment_leaderboard` (score, time, strongest and weakest category) and `assessment_category_scores` (one row per attempt per category)
   - `assessment_migrations`: which files in `supabase/migrations/` have been applied
   - `assessment_contributors`, `assessment_submissions`, `assessment_secrets`: team links, the questions sent through them, and the editor key's fingerprint
   - `assessment_rooms`, `assessment_room_members`, `assessment_room_answers`: group play (rooms are deleted two days after they were last used)
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

## Private links (no sign-in anywhere)

- **The editor's link** carries its key: `https://<site>/admin.html#key=…`. The browser remembers the key after the first visit, and the key is removed from the address bar. Saving, uploading pictures, the Team inbox and team links all need it. Only its SHA-256 is stored (table `assessment_secrets`). Make a new key, which turns the old link off, with `node scripts/editor-key.js https://<site>`. Until a key is set, the editor is open.
- **Team links:** in the editor's **Team** tab, add a person to get their link (`/contribute.html?t=…`). The link opens a page with the same question form as the editor: every type, pictures, Preview and the "needs fixing" checks. It never loads the bank, so they can't see existing questions. "Turn off" stops a link at once; what they sent stays.
- **Reviewing:** sent-in questions wait in the Team tab. **Add to the bank** opens the question in the editor as a new question; it's marked approved once the bank is saved. **Reject** takes it out of the inbox (with Undo).
- The test itself still downloads the whole bank to run (see `/api/questions`), so this keeps the bank out of sight rather than secret.

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

## Points

The score is points, not a percentage.

- **On your own:** +1 for each right answer, 0 for a wrong or skipped one.
- **With the team in the room:** the taker's points depend on how the team did on that question, and each teammate's on how the taker did. A teammate with no answer by the time the taker submits counts as wrong.

  | Taker | Team | Taker's points |
  | --- | --- | --- |
  | Right | everyone wrong | +10 |
  | Right | some wrong | +2 |
  | Right | everyone right | +1 |
  | Wrong | everyone wrong | 0 |
  | Wrong | some right | −3 |
  | Wrong | everyone right | −5 |

  | Teammate | Taker | Teammate's points |
  | --- | --- | --- |
  | Right | either | +1 |
  | Wrong | wrong | −5 |
  | Wrong | right | −10 |
- **Critical questions count double**, both ways.
- **Time running out:** the question on screen and any after it score nothing for anyone (they still count as wrong).
- The meter and the confetti still follow the share of right answers ("Confetti from" in Settings).
- Each result row's payload stores `points`, `mode` (`solo` or `group`), each answer's points, and in group play `room.people` (everyone's name, colour, points and right answers).

## Critical questions

- **Tick "Critical"** on any question in the editor. The candidate sees it flagged in red.
- **Each attempt is about 15% critical questions** (7 of 45), changeable in Settings under "Critical questions per attempt". It never goes above the number of critical questions in the bank.
- **Points count double** on a critical question, right or wrong.
- **Results list the critical errors.** Each result row in Supabase also stores `criticalErrors`.

## Group play

The test taker's briefing screen opens a room. It shows a QR code, a five-character room code and the `/join` address for laptops.

- **Joining:** teammates scan the QR code (or open `/join` and type the code), then give a name and pick a colour. A colour someone has taken disappears from everyone else's list. The taker can remove anyone from the lobby with ×.
- **Names stay hidden until the results.** Before then, teammates show up by colour only, in the lobby and during the test. The server doesn't send names out before the end either.
- **Starting:** with nobody in the room, the test runs on its own, exactly as before. With one or more teammates, Start sends everyone the same paper: the same questions, in the same order, with the same option order. Nobody can join after the start.
- **During the test:** the taker's screen is the main screen everyone watches. It shows each person as *Thinking…* (nothing picked yet), *Answering…* (picked something, not submitted) or *Answered*, and everyone's points so far. Teammates' screens show only the question, the clock and their own result.
- **The taker's submit** shows the right answer on every screen, stops the clock, and marks anyone who hasn't answered as wrong. Nobody can answer during that time. Only the taker has **Next**.
- **Results:** everyone sees the whole room. The taker is on top, then the team, best first, with names. The taker's own screen also has their stats, categories and certificate. Only the taker's attempt is recorded, with the room's scores in it.
- **Refreshing:** each browser keeps a random device id (in localStorage and sessionStorage), and the room stores only its SHA-256. A refresh, or closing the tab and opening the link again, gets the same seat, colour and answers back. A different browser or a private window counts as a new person. The taker's refresh resumes from the saved attempt.
- It needs the live site (Supabase). Offline (`server.py`) there's no lobby, and the test runs on its own.

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

- `index.html`, `assets/app.js`, `assets/meter.js`: the test (and the team's join and answer screens)
- `assets/group.js`: group play in the browser (the room, device id, colours, points rules, QR code); `assets/qrcode.js` is [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT)
- `admin.html`, `assets/admin.js`: the editor
- `assets/common.js`: shared helpers (answer matching, categories, the random draw)
- `contribute.html`: the team's page for sending in questions (runs `assets/admin.js` in contribute mode)
- `api/questions.js`, `api/results.js`, `api/people.js`, `api/images.js`, `api/contribute.js`, `api/submissions.js`, `api/contributors.js`, `api/editor.js`, `api/room.js`, `api/_store.js`: Vercel functions that talk to Supabase
- `scripts/editor-key.js`: makes a new editor key and prints the editor link
- `dev-server.js`: local server running those same functions, with auto-refresh
- `server.py`: offline local server, file-based
- `data/questions.json`: the seed question bank and settings
