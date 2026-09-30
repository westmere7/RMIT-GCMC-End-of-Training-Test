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
   - `assessment_rooms`, `assessment_room_members`, `assessment_room_answers`: group play. Rooms clean themselves up: a lobby whose taker has gone for 30 minutes, a test nobody has driven for 3 hours, a finished room after 12 hours, and anything untouched for 2 days. A teammate whose page goes quiet in the lobby for 2 minutes gives their seat and colour back.
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
- **Match pairs:** each row in the editor is one pair (Column A → Column B), 2 to 3 pairs. Candidates see Column A on the left and Column B (shuffled) on the right, and link each pair by clicking one item then its match, or dragging between them. Each link is drawn as a coloured line, with the same number on both ends; clicking a pair again undoes it. Every pair must be right for the mark. Stored as `"pairs": [{ "left": "...", "right": "..." }]`.
- **Image question:** either a picture with the question (with text options below it), or pictures as the options (no text allowed on them). "More than one correct" turns it into select-all-that-apply. Pictures are converted to WebP in the editor (longest side 1600 px for the question, 1000 px for options) and must come out under 3 MB; they're stored in Supabase Storage, and the question keeps only their links. Offline (`server.py`) they go to `data/images/`.
- **Fill in the blank:** the prompt has `___` where the gap goes; answers are typed.
- **Short answer:** a typed answer. For both typed types, capitals, accents, spaces and punctuation are ignored, and the first accepted answer is the one shown as correct.

**Preview:** every question has a Preview button (Alt+P) in the editor. It opens the real test page with that question, including unsaved edits. Answer it to check the marking; nothing is saved or sent.

## Points

The score is points, not a percentage.

- **On your own:** +1 for each right answer, −1 for a wrong or skipped one. Questions time ran out on score nothing.
- **With the team in the room:** the taker's points depend on how the team did on that question, and each teammate's on how the taker did. A teammate with no answer by the time the taker submits counts as wrong.

  | Taker | Team | Taker's points |
  | --- | --- | --- |
  | Right | everyone wrong | +10 |
  | Right | some wrong | +2 to +9: the bigger the share who got it wrong, the more (1 + 9 × share, rounded) |
  | Right | everyone right | +1 |
  | Wrong | everyone wrong | 0 |
  | Wrong | some right | −2 to −1: the bigger the share who got it right, the more it costs (−3 + 3 × share wrong, rounded) |
  | Wrong | everyone right | −3 |

  Because each teammate counts the same, a bigger room doesn't change what a taker scores on average (see `node tests/simulate.js`).

  | Teammate | Teammate's points |
  | --- | --- |
  | Right | +1 |
  | Wrong (or no answer) | −2 |

  Whatever the taker did, so teammates are ranked on their own answers alone. A teammate who gets about two thirds right ends up around zero; better than that gains, worse loses.
- **Critical questions count double**, both ways.
- **Time running out:** the question on screen and any after it score nothing for anyone (they still count as wrong).
- **The meter** (taker's screen) shows where you stand: right answers against wrong ones, critical questions counting double, with or without the team in the room, so a newcomer's meter and award don't depend on how good the team is. Half right sits in the middle, two thirds reaches "welcome", about 95% the award zone at the top end (see below). The scale starts at half the paper and widens to the whole paper by the end, so a right answer always moves the needle up by a real step (about a third of what a miss takes off, even near the top), and the final reading is right against wrong plus any streak boost. **Streak boost:** from 3 right in a row a right answer climbs ×1.15, from 5 ×1.3; what it adds stays after a miss and counts towards the award (so a streaky run needs slightly fewer right than a scattered one). A question answered with Gauge neither adds to a streak nor ends one. The boost shows as small gold text under the points. The needle is a straight pointer that leaves a motion trail as it swings, longest after a big bounce. Under the arc it shows the points so far, the question and the current streak; each answer sends a ripple and its points up from the needle. With the team in, each teammate is a small mark on the arc (their colour and initial) showing their right against wrong so far, critical questions counting double, linked to a badge with their name. The marks glide, without the needle's bounce, and the badges never overlap each other, the taker's name tag, the needle or the award label.
- **The award zone** is the purple top of the meter (it starts to glow and shimmer as the needle nears it), the top 5% by default ("Award zone" in Settings). The moment the needle touches it: shock rings, sparks, a surge of light up the arc, an AWARD ZONE! banner, confetti and a fanfare; while it stays there, light rays turn behind the zone and each right answer throws more sparks. Finish in it and there's confetti, the results say **🏆 Award**, and the result row stores `award: true` (with `meter`, the final reading), so you know who's earned one.
- **Rules** (the small button on the timer) opens the rules during the test: time, submitting, critical questions, the meter, the points for this game and the powerups. It's on every screen, teammates' included. The briefing's points card lists the powerups too.
- **Right or wrong** flashes up on the taker's screen after each answer: a headline, the points counting up, and chips for whatever changed them (a critical question, a double down that paid off or backfired, a bet won or lost, a charge earned). A big win (the whole team beaten, a bet won, a double down paid off, 10 points or more) goes gold with a burst of confetti; a miss shakes. It fades by itself and never blocks a click. The right tile lights up and a wrong pick is marked.
- **The taker's screen** is the arena: a navy HUD over the question, a glowing Lock it in, a heartbeat on the clock in the last 30 seconds, and short synthesised sounds (a chime that climbs with a streak, a fanfare for a big win, a buzz for a miss). The speaker button on the timer mutes them, and it's remembered. The team's screens keep the plain look, without sound.
- **The certificate** shows the taker's own points (+1 right, −1 wrong, critical ×2), with or without the team, and the results say so in group play. The recorded `points` are the room's (without powerups); `ownPoints` stores the taker's own.
- Each result row's payload stores `points`, `ownPoints`, `mode` (`solo` or `group`), each answer's points, and in group play `room.people` (everyone's name, colour, points and right answers).

## Critical questions

- **Tick "Critical"** on any question in the editor. The candidate sees it flagged in red.
- **Each attempt is about 15% critical questions** (7 of 45), changeable in Settings under "Critical questions per attempt". It never goes above the number of critical questions in the bank.
- **Points count double** on a critical question, right or wrong.
- **Results list the critical errors.** Each result row in Supabase also stores `criticalErrors`.

## Group play

The test taker's briefing screen opens a room. It shows a QR code, a five-character room code and the `/join` address for laptops.

- **Joining:** teammates scan the QR code (or open `/join` and type the code), then give a name and pick a colour. A colour someone has taken disappears from everyone else's list. The taker can remove anyone from the lobby with ×.
- **Names and colours** show everywhere: in the lobby, on the taker's screen during the test, and on the results.
- **Starting:** with nobody in the room, the test runs on its own, exactly as before. With one or more teammates, Start sends everyone the same paper: the same questions, in the same order, with the same option order. Nobody can join after the start.
- **During the test:** the taker's screen is the main screen everyone watches. It shows each person as *Thinking…* (nothing picked yet), *Answering…* (picked something, not submitted) or *Answered*, and everyone's points so far. Teammates' screens show only the question, the clock and their own result.
- **The taker's submit** shows the right answer on every screen, stops the clock, and marks anyone who hasn't answered as wrong. A teammate who has picked something but not pressed Submit has that pick counted as their answer (the page sends it as they go). Nobody can answer during that time. Only the taker has **Next**.
- **Powerups (the taker only):** every run of 3 right answers in a row earns a charge, shown as ⚡ on the Powerups card. The taker holds 2 at most, and a run that ends with both full earns nothing. A charge buys one powerup on the question on screen, before submitting; both on one question costs two. Each has a catch:
  - **Double down:** the taker's points on this question count twice, right or wrong (so −6 instead of −3). It takes two clicks and can't be taken back, and everyone watching sees ×2 on the question.
  - **Gauge the room:** see one teammate's pick as it stands, marked on the question with their initial (a match shows its pairs, a typed answer its text). Only teammates who have picked something can be chosen. If they haven't submitted, they can still change it, and they may be wrong. Going with the team pays little anyway (+1 when everyone's right).
  - **Bet on the team:** bet on how many teammates get it wrong (anyone with no answer counts as wrong). Exactly right wins 2 + 2 a teammate (+4 with one, +8 with three), on top of the question's points; anything else loses 3. The catch: the bet is on the main screen, so the team can play against it, though a wrong answer costs them. A Double down doubles the question's points, not the bet.
  - **On the big screen:** using a powerup takes over the taker's screen for a moment (the room is watching it): what it is and what it does (the ×2, the teammate's pick, the bet). At the reveal, after the right/wrong card, each powerup's outcome gets the same treatment: ×2 paid off or backfired (the points before and after), the bet won or lost, and whether the gauged teammate was right. Gold for a powerup going on, gold and green for a win, red with a shake for a loss. It fades by itself and never blocks a click.
  - **For fun only:** powerups change the room's scoreboard (the side panel, the points under the meter, the reveal, and the room on the results). The recorded points leave them out, and the meter's needle, the award and the certificate follow the taker's answers alone. The taker's results say what they scored on the scoreboard as well.
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

## Tests

- `node --test tests/*.test.js` also runs `tests/fairness.test.js`: simulated rooms, powerups included, checking that teammates are scored on their own answers alone (the same answers score the same whatever the taker does, and more right always ranks higher), that breaking the taker's bet on purpose costs the saboteur, that powerups never touch the recorded points or the meter, that the meter reads the taker's answers however strong the team, that copying a teammate with Gauge never reaches the award, and that powerups don't let a weak taker overtake a strong one.
- `node --test tests/*.test.js` checks the points rules (every case, critical ×2, on your own), their limits, and the meter (range, zones, when confetti lands), plus simulated sittings that check a stronger player always scores more.
- `node tests/simulate.js` prints what scores look like in practice: taker and teammate points at different skill levels and room sizes, and where the meter ends up.
- They run the real `assets/common.js`, `group.js` and `meter.js`, with nothing to install.

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
