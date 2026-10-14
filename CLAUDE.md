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
- `chléb pšenično-žitný` has no match (all candidates were brand products) - edit `matches.json` or relax the pick prompt.
- Gram amounts are Gemini estimates for a typical high-school portion.
- Menu changes after a day was sent are not re-sent; delete the day from `sent.json` and the bot's Oběd to redo it.
- `ingredients.mjs` could import `gemini.mjs` instead of duplicating the helper.
- Once the user has eStrava credentials, read the real orders instead of defaulting to "Oběd 1".
- Possible popup/notification at startup instead of a silent background run.
- The bot password should be changed (it is in this chat's history).
