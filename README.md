# KalorickeTabulkySender

**You photograph your school lunch. Everything else happens by itself.**

This project takes the lunch menu of the school canteen, works out what is actually on your plate from a photo,
writes every ingredient into the [Kalorické tabulky](https://www.kaloricketabulky.cz) food diary, and shares that
diary entry with you (and anyone else you choose). It runs in the cloud, so your computer can be off, and it asks
you on your phone when it is not sure about something.

It is built for one person's daily routine, but nothing in it is secret or clever, so it is meant to be read,
understood and changed.

---

## What a normal day looks like

1. You sit down with your lunch and take a photo of the tray in the **Lunch** app on your phone.
2. A few minutes later the lunch is in your Kalorické tabulky diary, ingredient by ingredient, with grams that match
   what is really on the plate. Your friends who are on the list get the same lunch.
3. If something on the tray is not part of the menu and the app is not sure what it is (a bread roll? someone else's
   drink?), your phone buzzes with a pop-up: *"Is this part of your lunch?"*. You tap it, see a close-up crop of your
   photo, correct the name or the grams if you like, and press **Add it** or **Skip it**.
4. If you forget the photo, nothing is lost: at 20:00 the app sends its best guess for a typical portion instead.

You never have to open the Kalorické tabulky app to type anything in.

---

## How it works, step by step

```
 canteen website ──► menu ──► lunch of the day ──► ingredients (AI) ──► matched foods
                                                                              │
 your photo ──► grams + extra food on the tray (AI) ────────────────────────┤
                                                                              ▼
                              bot account diary (Oběd)  ──►  shared to you and your friends
```

1. **Menu.** The canteen publishes its menu as public data. The script downloads it, throws away allergen codes,
   soups and the vegetable bar, and picks one main meal per day (lunch number 1 unless you chose otherwise).
2. **Ingredients.** An AI (Google Gemini, free tier) splits each lunch into ingredients with typical grams, for
   example *"Hovězí guláš, houskový knedlík"* becomes beef, onion, dumplings, oil, flour and stock.
3. **Matching.** Each ingredient is matched to a real food in the Kalorické tabulky database. The AI picks the
   closest generic food (not a brand product) when there are several.
4. **The photo.** The AI looks at your photo with the ingredient list, estimates how much of each thing is really on
   the plate, and spots anything on the tray that is not in the menu (bread, fruit, a dessert, a drink).
   Things it is sure about are added; things it is unsure about become a question for you.
5. **Writing and sharing.** The ingredients are written into the **Oběd** (lunch) section of a separate **bot
   account** on Kalorické tabulky, and that Oběd is then shared with you through the app's normal sharing feature,
   exactly as you would share it with a friend by hand.

### Why a bot account?

Your main Kalorické tabulky account logs in with Google, and Google deliberately blocks automated logins. A plain
e-mail-and-password account has no such problem, so the project uses one as a middleman. Sharing lunches between
accounts is something Kalorické tabulky already supports, so nothing unusual is happening on their side.

---

## The pieces

| Piece | What it is | Where |
|---|---|---|
| **The scripts** | Plain Node.js programs, one per step, no dependencies (except one for notifications) | the `.mjs` files in this folder |
| **The cloud job** | GitHub Actions runs the whole chain on its own servers, on a schedule and whenever you upload a photo | `.github/workflows/lunch.yml` |
| **The phone app** | A small web app you install on your phone: take the photo, watch progress, answer questions | `webapp/`, published from a second, public repo `lunch-photo` |
| **The notes it keeps** | What was sent, grams per day, caches and the live status, all stored in this repo | `sent.json`, `portions.json`, `matches.json`, … and the `status` branch |
| **Notifications** | Pop-ups on your phone through the free [ntfy](https://ntfy.sh) app | `notify.mjs` |

Everything is free: GitHub's free tier, Gemini's free tier, ntfy and GitHub Pages.

---

## The phone app

Open it from the home screen like any other app. It has two tabs.

**Photo**
- Pick the day (it starts on today, with `<` and `>` to move), see which lunch is planned.
- *Take photo* opens the camera inside the app; *Choose from gallery* uses a photo you already have.
- *Send photo* uploads it. The app then jumps to the Dashboard.

**Dashboard**
- **Alerts at the top** (and a red dot on the tab) when something needs your attention: Gemini's free quota is used
  up or it is overloaded, the bot account cannot log in, the repository is getting big, your token stopped
  working, or the whole pipeline has been silent for days.
- **Steps** of the current or last run with a ✓, ⟳ or ✗ for each: downloading the menu, splitting into ingredients,
  matching, reading the photo, waiting for your answer, writing to the diary, sharing.
- A **terminal** with the live output, so you can see exactly what is happening, even when it fails.
- If something fails: **where** it failed, **why** in plain words, what to do about it, and **when it tries again**.
- A short list of recent runs.

**Settings** (at the bottom): the repository name and your GitHub token, plus the notification test button.

---

## Setting it up from scratch

You only do this once. Roughly 30 minutes, most of it creating accounts.

### 1. Accounts and keys
- A **GitHub** account and a private repository with this code.
- A **bot account** on Kalorické tabulky with a plain e-mail and password (not Google). Connect your own account as
  a person for it, the same way you would add a friend you share lunches with.
- A free **Gemini API key** from Google AI Studio.

### 2. Secrets in the repository
In the repository: *Settings → Secrets and variables → Actions*, or from a terminal with
`gh secret set NAME --repo OWNER/REPO` (it asks for the value, so it never lands in your shell history).

| Secret | What it is |
|---|---|
| `GEMINI_API_KEY` | your Gemini key |
| `KT_EMAIL`, `KT_PASSWORD` | the bot account's login |
| `KT_SEND_TO` | e-mails of everyone who should get the lunch, separated by commas. Each must be a connected person of the bot account |
| `NTFY_TOPIC` | a long random name for your notification channel, for example `lunch-` plus 20 random characters. It works like a password |
| `VAPID_PRIVATE_KEY` | optional; only for the browser-notification fallback described in `docs/phone-notifications-guide.md` |

Never put these in a file that is committed. The local `.env` file is git-ignored and only needed if you run the
scripts on your own computer.

### 3. The phone app
- The app lives in `webapp/`. GitHub Pages only serves public repositories on a free plan, and the app contains no
  secrets, so it is published from a separate small public repository (here: `lunch-photo`). Copy `webapp/*` there
  whenever the app changes.
- On GitHub create a **fine-grained token** limited to this one repository, with **Contents: read and write**.
- Open the published page on your phone, then *Install app* / *Add to Home Screen* in Chrome. In the app's Settings
  paste the token. It is saved only in the phone's browser.

### 4. Notifications
- Install the **ntfy** app on your phone, press **+**, and subscribe to the same topic name you stored in `NTFY_TOPIC`.
- In Android's notification settings for ntfy, allow pop-ups on screen.
- Check it: GitHub → Actions → *lunch* → *Run workflow* → tick `test_push`. A pop-up should appear within seconds.

### 5. First run
Take a photo in the app, or start the workflow by hand from the Actions tab. Watch the Dashboard.

---

## Day to day

### Adding someone to the list
Connect them as a person in the bot account on Kalorické tabulky, then add their e-mail to the `KT_SEND_TO` secret.
They get new lunches from then on. To give them a lunch that was already sent, remove that day's entry for them
in `sent.json` and start a run.

### A lunch looks wrong
- The grams are an AI's estimate from a photo, and typically within about ±20% per item. Dense foods such as
  potatoes and meat are the hardest to judge.
- A wrong ingredient match can be fixed by editing `matches.json` (it is meant to be hand-editable; delete an entry to
  have it redone).
- To redo a whole day: empty that day's Oběd in the bot account, remove the day from `sent.json`, and start a new
  run. Every share creates **another copy** for the recipients, so delete their old copy first.

### Something failed
Open the Dashboard. The red box tells you where and why, and when it will try again. A failed day is retried by the
next run automatically, and finished days are never repeated. You can also start a run yourself:
**Actions → lunch → Run workflow**. Use that and not *Re-run all jobs*: a re-run uses the code from when the
original run started, so it would not include your fixes.

---

## When does it run?

- Right after you upload a photo, and right after you answer a question.
- Every weekday at 05:00 and 19:00 UTC: the early run prepares ingredients, the evening run sends the estimate for
  days without a photo (the cut-off is 20:00 Prague time).
- Whenever you start it by hand, with optional switches: a login check, a test notification, or *publish status*.

A day is only ever sent once to each person. Weekends and school holidays have no lunch and are skipped.

---

## Limits you should know about

- **Gemini's free tier** is sometimes overloaded or out of quota for the day. The app tries several models, gives up
  on a stuck request after 60 seconds, retries once after a minute, and shows an alert. It recovers by itself.
- **Estimates, not scales.** The photo gives a good guess, not an exact weight.
- **No official API.** Kalorické tabulky has no public API; the project uses the same requests the website makes. If
  the site changes, the write or share step may break, and the Dashboard will say where.
- **One canteen.** The menu source is hard-wired to Gymnázium Orlová (eStrava `idzar=103`). Another canteen needs the
  address changed in `scrape.mjs`.

## Privacy and safety

- The photos are stored in your **private** repository. The public repo only holds the app page, with no secrets.
- Your GitHub token is typed once on your phone and stays there. It can only touch this one repository.
- `sent.json` contains the e-mails of the recipients, which is another reason for keeping the repo private.
- The notification topic name is a password: anyone who knows it can read the notifications. Keep it long and random.
  The messages contain only short texts like "chléb - 2026-10-23. Tap to answer."
- Change the bot account's password if it has ever been pasted somewhere you do not control.

---

## Running the scripts on your own computer

Everything has a dry-run default: nothing is written or sent unless you add the matching flag.

```bash
node scrape.mjs                          # download the menu          -> menu.json
node lunches.mjs                         # pick the lunch of each day -> lunches.json
node ingredients.mjs                     # AI splits lunches          -> ingredients.json   (needs GEMINI_API_KEY)
node match.mjs                           # match to real foods        -> matches.json
node portion.mjs --date 2026-10-14       # grams from photos/2026-10-14.jpg
node write.mjs --date 2026-10-14         # dry run; add --write to really write the bot diary
node send.mjs  --date 2026-10-14         # dry run; add --send to really share it
node daily.mjs --week --photos           # the whole chain for this week; add --go to do it for real
```

A local `.env` file (copy `.env.example`) holds the same values as the secrets. Requires Node 24.

---

## What is in the folder

| File | What it does |
|---|---|
| `scrape.mjs`, `lunches.mjs`, `choose.mjs` | download the menu, pick the lunch per day, optional picker for days with two lunches |
| `ingredients.mjs`, `match.mjs`, `gemini.mjs` | the AI steps and their shared helper |
| `portion.mjs`, `plan.mjs` | read the photo; combine menu items, extra food and your answers into the final list |
| `write.mjs`, `send.mjs`, `recipients.mjs` | write to the diary, share it, remember who got what |
| `daily.mjs`, `status.mjs`, `notify.mjs` | run the whole chain, publish live progress, send notifications |
| `webapp/` | the phone app (page, service worker, icons) |
| `.github/workflows/lunch.yml` | the cloud job |
| `sent.json`, `portions.json`, `matches.json`, `ingredients.json`, `menu.json`, `lunches.json` | the project's memory, committed back by the cloud job |
| `photos/`, `answers/`, `push/` | your lunch photos, your answers to questions, notification settings |
| `docs/` | a guide for reusing the notification setup in another project |
| `CLAUDE.md` | detailed technical notes, kept for the AI assistant that helps maintain the project |
| `install-task.ps1` | old fallback that ran everything from a Windows laptop at logon. Do not use it while the cloud job is active, or lunches would be sent twice |

## Frequently asked

**Do I need my computer on?** No. Only your phone, for the photo and for answering questions.

**What if I eat something that is not on the menu?** The AI notices extra food on the tray. If it is sure, it adds it;
if not, it asks you.

**What if I skip the photo?** At 20:00 the estimate for a typical portion is sent instead, so no day is empty.

**Can I answer later?** Yes, until 20:00 on that day. After that the unsure items are simply left out.

**Why did it send the same lunch twice?** Each share to a person creates another copy in their diary. It happens only
when a day is deliberately redone.

**Where can I see what it did?** The Dashboard in the app, or the *Actions* tab on GitHub.
