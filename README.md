# KalorickeTabulkySender

Automatically reads the canteen's daily lunch menu and sends it to Kalorické tabulky.

## Usage

```
node scrape.mjs    # canteen menu -> menu.json
node lunches.mjs   # pick the lunch per day -> lunches.json (default: "Oběd 1")
node choose.mjs    # optional: override the default on days with two lunches
```

## Planned

- Read the real orders from eStrava after login (credentials in `.env`, never committed).
- AI step: split each lunch into ingredients, then match them to Kalorické tabulky.
- Popup on startup via Task Scheduler.
