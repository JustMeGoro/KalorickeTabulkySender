# KalorickeTabulkySender

Automatically takes the school canteen lunch menu and gets it into the user's Kalorické tabulky (kaloricketabulky.cz) diary, ingredient by ingredient.

## How it works

```
canteen API -> menu.json -> lunches.json -> ingredients.json -> matches.json
   scrape        scrape       lunches         ingredients          match
-> write to BOT account diary (Oběd) -> share Oběd to the user's MAIN account
        write.mjs                              send.mjs
```

`node daily.mjs [--week] [--date YYYY-MM-DD] [--go]` runs the whole chain. Without `--go` it is a dry run
(write/send only print what they would do). A Windows Task Scheduler task (`install-task.ps1`) runs
`daily.mjs --week --go` one minute after logon.

Why a bot account: the user logs into Kalorické tabulky with Google, which blocks automated login. A separate
e-mail/password account logs in over plain HTTP, and sharing "Oběd" to the main account is something the user already
does by hand with friends.

## Files

| File | Purpose |
|---|---|
| `scrape.mjs` | Canteen JSON API -> `menu.json` (no allergens/soups/ratings, "zel. bar" stripped; drinks kept as `type: drink`) |
| `lunches.mjs` | Picks one main meal per day -> `lunches.json`. Default "Oběd 1"; `selection.json` overrides |
| `choose.mjs` | Optional interactive picker that writes `selection.json` (gitignored) |
| `ingredients.mjs` | Gemini splits each lunch into ingredients + grams -> `ingredients.json` (cached by meal name) |
| `match.mjs` | Matches ingredient names to Kalorické tabulky foods via public autocomplete + Gemini pick -> `matches.json` (cached; hand-editable) |
| `write.mjs` | Logs in as the bot, writes one day's ingredients into Oběd. Dry run unless `--write` |
| `send.mjs` | Shares that day's Oběd to `KT_SEND_TO`. Dry run unless `--send`; records `sent.json` |
| `recipients.mjs` | Parses `KT_SEND_TO` and tracks per-recipient sent state |
| `daily.mjs` | Orchestrates everything, one day or a week |
| `gemini.mjs` | Shared Gemini helper with model fallback (`ingredients.mjs` still has its own copy of this logic) |
| `install-task.ps1` | Registers the logon task (run once per computer) |

Gitignored local state: `.env`, `selection.json`, `sent.json`, `daily.log`.
`.env` keys: `GEMINI_API_KEY`, `KT_EMAIL`, `KT_PASSWORD` (bot account), `KT_SEND_TO` (comma-separated e-mails of everyone who should get the Oběd; each must be a connected person of the bot account), optional `GEMINI_MODEL`.

## Photo mode (cloud, live since 2026-10-15)

Idea from the user: break the lunch into ingredients early, but only send once the user has photographed the plate on the phone; Gemini then corrects the grams from the photo.

- `webapp/index.html`: single-file phone web app. Picks the day, takes/chooses a photo, shrinks it to 1280 px JPEG and uploads it to `photos/<date>.jpg` in this private repo through the GitHub contents API with a fine-grained token (this repo only, Contents read/write) kept in the phone's localStorage. Hosting: GitHub Pages needs a public repo on a free plan, and the page itself holds no secrets, so put the file in a separate public repo (or any static host).
- `portion.mjs --date D`: Gemini vision gets the photo + ingredient list + estimates and returns grams -> `portions.json`. Values are clamped to 0.25x-2.5x of the estimate. `write.mjs` prefers `portions.json` over the estimates.
- `daily.mjs --photos`: a day is sent only when `photos/<date>.jpg` exists; without a photo it waits until `CUTOFF_HOUR` (default 20) of that day and then sends the estimate. Ingredients/matching still run early for all pending days.
- `.github/workflows/lunch.yml`: runs `daily.mjs --week --go --photos` in GitHub Actions on photo upload, weekdays 05:00 and 19:00 UTC, or manually. Needs repo secrets `GEMINI_API_KEY`, `KT_EMAIL`, `KT_PASSWORD`, `KT_SEND_TO` (set by the user, never by Claude). It commits `sent.json`, `portions.json` and the data caches back to the repo, so `sent.json` is no longer gitignored.
- The laptop logon task was removed on 2026-10-15 (cloud sends instead; `install-task.ps1` is kept only as a fallback - do not run it while the workflow is active or both would send). Verified: the workflow runs with the secrets, and a read-only login check (`workflow_dispatch` with `check_login`) logs in to Kalorické tabulky from GitHub. Not yet verified in the cloud: write + send + the photo step (first real day: 2026-10-19).

## Dashboard (built 2026-10-23)

The app has a Photo tab and a Dashboard tab. The Dashboard shows what the cloud run is doing: steps with state, a live terminal, the failure (where + why + hint) and when the next attempt is, plus recent runs.

- `status.mjs`: used by `daily.mjs` (which now spawns the step scripts asynchronously and streams their output). In Actions it pushes `status/run.json` (latest run that did work or failed: phases, last 600 terminal lines, failure, next attempt, first attempt log on retry) and `status/history.json` (one line per run) to an orphan `status` branch through the GitHub contents API, at most one push every ~2.5 s. Locally it does nothing. `explain()` turns known errors (Gemini timeout/overload, bot login, missing recipient, partial write...) into a reason and a hint.
- Runs with nothing to do and nothing failing only add a history line (so a quiet cron run never hides an earlier failure); `workflow_dispatch` input `publish_status` forces publishing.
- The app reads those files with the same token (Contents: read is enough), polling every 4 s while a run is active, else every 20 s.
- Workflow retry: `RUN_ATTEMPT` / `WILL_RETRY` env tell `status.mjs` whether a retry follows. Gemini calls have a 60 s timeout (`gemini.mjs`).
- Alerts: `status/alerts.json` (kept across runs) is shown at the very top of the Dashboard, with a red dot on the tab. `status.mjs` raises `gemini-quota` (429 whose body says quota/RESOURCE_EXHAUSTED; `gemini.mjs` logs `HTTP 429 QUOTA exceeded`), `gemini-overload` (>= 6 5xx/timeouts in a run), `kt-login` (Login failed) and `repo-size` (>= 800 MB), and clears them when that part of the pipeline works again. The app itself adds "GitHub token rejected" (401) and "no run for > 100 h". Actions minutes cannot be read with the workflow token, so there is no alert for them.
- Camera: the Take photo button opens the camera inside the app (`getUserMedia`, shot drawn to a canvas, max 1280 px) because handing over to the phone's camera app can make Android restart the installed app and lose the photo; the phone's camera app (`capture` input) is only the fallback. Not verified on the phone yet.
- Verified: publishing from Actions works (run 2026-10-23). The Dashboard layout was checked with fake data in the browser pane, not yet on the phone.

## Extra food on the tray and questions (built 2026-10-23)

Gemini now also looks for food on the tray that is not in the menu (bread, roll, fruit, dessert, drink) and the app can ask about unsure things.

- `portion.mjs` returns `items` (menu ingredients, grams from the photo) and `extras` (name, grams, `confident`, `box` = [ymin,xmin,ymax,xmax] in 0-1000, note) -> `portions.json`. Sure extras are added automatically; unsure ones are questions. It skips a photo it already processed (hash); `--force` redoes it.
- `plan.mjs`: `finalItems(date)` = menu items + sure extras + unsure extras the user answered "add" to (`answers/<date>.json`, written by the app, `{ "<extra id>": { action, name, grams } }`). `write.mjs` uses it; `match.mjs` also matches extra names. `closeDay(date)` marks a finished day so the app stops asking.
- `daily.mjs`: after the portions step, unsure extras without an answer -> push notification (`notify.mjs`, once) and the day waits ("Waiting for your answer" on the dashboard) until the user answers or the cutoff hour passes (then the unsure items are left out). An answer commit (`answers/**`) starts the workflow again. Simulated locally (hold, answered, after cutoff) with a sandbox copy; not run on the real cloud yet.
- Notifications: Web Push. `push/vapid-public.txt` (public) + secret `VAPID_PRIVATE_KEY` (set by the user); the app stores the subscription of the phone in `push/subscriptions.json` (Settings -> Enable notifications). `notify.mjs` uses the `web-push` npm package (`package.json`, `npm ci` in the workflow; every other script is dependency-free). Workflow input `test_push` sends a test notification.
- Samsung (One UI) delivers the Web Push notifications to the shade with sound and the plate icon but never pops them up on screen, even with every Android setting on (checked 2026-10-23). Workaround: `notify.mjs` sends through ntfy (https://ntfy.sh, JSON publish, priority 4, `click` = the app) when the secret `NTFY_TOPIC` is set (a long random topic name = the password); then Web Push is not used. Verified on the phone 2026-10-23: ntfy pops up on screen. The `icon` field (Lunch icon) is sent but the phone did not show it; the small status-bar icon belongs to the ntfy app and cannot be changed by the sender. Do not use "Re-run all jobs" to test changes: a re-run uses the workflow and code of the original commit. Start a new run with `gh workflow run lunch.yml -f test_push=true`.
- The app: banner + modal with the crop of the photo (canvas crop of the box), editable name/grams, Add it / Skip it; opened from the notification (`sw.js` push + click handler, `?q=1`).
- `match.mjs` now retries a `no_match` once with a relaxed prompt ("closest generic food"), which fixed `chléb pšenično-žitný`. That was why the bread of 2026-10-23 was missing from the diary: the photo step had 90 g, but unmatched ingredients are skipped.
- Not yet verified on the real phone/photo: detection of extras with a positive example, the push notification, the modal.

## Facts about the external services

- **Canteen (eStrava, Gymnázium Orlová, `idzar=103`)**: `https://secure.ulrichsw.cz/estrava/api/?v=1&action=publicjidelnicek&idzar=103&typ=2&lang=CZ` is public JSON, no login. The web page itself is an SPA.
- **Kalorické tabulky search**: `GET /autocomplete/foodstuff-meal?query=...&format=json`, public. `id` there is the same GUID the add form uses.
- **Login**: `POST /login/create?=&format=json&voucher=false` with `{email, password: md5(password)}`; session cookie `JSESSIONID`.
- **Read diary**: `GET /user/diary/DD.MM.YYYY/get?format=json` -> `data.times[]`, Oběd has `id: "3"`.
- **Add a food**: `GET /user/foodstuff/add/form/<id>/<date>/get?format=json`, then `POST /user/foodstuff/add?format=json&=` with that object.
  - The form always comes back with **today's** date in `date`; it must be overwritten (an earlier bug wrote a whole day into the wrong date).
  - Every food has a "1 g" unit (`multiplier: 1`), so set `unitGuid` to it and `multiplier` to the grams. Fallback is the default unit with a computed fraction.
- **Share Oběd**: `GET /user/settings/share/item/diary-time/form/DD.MM.YYYY/3?format=json`, then `POST /user/settings/share/item/diary-time?format=json` with that object. The recipient is `guidUserTo`; `form.identifierOptions[]` maps `userFromId` -> `userFromIdentifier` (e-mail). `send.mjs` looks each `KT_SEND_TO` entry up there, sets `guidUserTo` to its `userFromId` and posts once per recipient; entries not in the list are reported and skipped. `sent.json` is `{date: {email: timestamp}}` (`recipients.mjs`); the old single-timestamp format counts as "sent to everyone". Verified on 2026-10-14: sending to a second recipient (dadicena@gmail.com) arrived in that account only. To backfill an already-sent day for a new person, edit that day in `sent.json` so only the earlier recipients are listed, then run `send.mjs --date ... --send`.
- **Gemini free tier**: models are often overloaded (503/429) so the code rotates `gemini-3.5-flash` -> `gemini-flash-latest` -> `gemini-3.1-flash-lite`. `gemini-2.5-flash` is closed to new users. A full first run for a month takes ~10 minutes.

## Working agreements with the user

- Reply in English (global setting), even when the user writes Czech.
- **Never enter, request or repeat credentials.** The bot password was pasted into chat once; the user runs everything that logs in (`write`, `send`, `daily`). Claude only runs steps that need no login (scrape, lunches, ingredients, match).
- The built-in browser was used for read-only exploration plus two throw-away test entries; real writes/sends are the user's call, dry run first.
- Windows PowerShell 5.1: no `&&`, use `;`.
- Shell heredocs/sed in this environment **lose backslashes** in regexes. Use the Write/Edit tools for any file with regex.

## Status (2026-10-14)

Working end to end. Verified by the user: scrape -> lunches -> ingredients -> match -> write -> send for single days, a Thursday+Friday batch, and an automatic logon run that sent 2026-10-14 (see `sent.json`). Multiple recipients (`KT_SEND_TO` list) also verified; `daily.log` is UTF-8.

## Known issues / ideas

- `sent.json` is local: if the task runs on two computers on the same day, the lunch is shared twice. Option: store "sent" in the bot account instead.
- The task only exists on `GORONOTEBOOK`; another computer needs a clone, its own `.env`, and `install-task.ps1`.
- Gram amounts are Gemini estimates for a typical high-school portion.
- Menu changes after a day was sent are not re-sent; delete the day from `sent.json` and the bot's Oběd to redo it.
- `ingredients.mjs` could import `gemini.mjs` instead of duplicating the helper.
- Once the user has eStrava credentials, read the real orders instead of defaulting to "Oběd 1".
- Possible popup/notification at startup instead of a silent background run.
- The bot password should be changed (it is in this chat's history).
