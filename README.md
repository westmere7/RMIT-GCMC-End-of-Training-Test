# End-of-Training Assessment

**Run it locally:** double-click `Start Test.bat` (needs Python). It opens http://localhost:8765/.

- **Test:** `http://localhost:8765/`
- **Editor (hidden, not linked anywhere):** `http://localhost:8765/admin.html`

## Files
- `data/questions.json`: settings, sign-in gate and all questions. The test reads it every time it loads.
- `index.html` + `assets/app.js`, `assets/meter.js`: the test itself.
- `admin.html` + `assets/admin.js`: the editor.
- `server.py`: serves the folder and lets the editor save straight to `data/questions.json`. It keeps a copy of the previous version in `data/backups/` and saves each finished attempt to `data/results/`.

## Editing
- In the editor, change anything and press **Save changes**.
- Running through `server.py`, it writes `data/questions.json` directly.
- On any other web host, it downloads a new `questions.json` instead. Replace `data/questions.json` with it.

## Sign-in gate
Set the candidate's email and staff ID in the editor under **Sign-in gate**, then save. Until then, any RMIT email and staff ID will be accepted. The values are stored as SHA-256 fingerprints.

## Resetting an attempt
Progress is kept per browser tab, so a refresh doesn't stop the clock. To start again, press **Sign out** on the results page or close the tab.
