# KalorickeTabulkySender

Automatically reads the canteen's daily lunch menu and sends it to Kalorické tabulky.

## Usage

```
node scrape.mjs    # canteen menu -> menu.json
node lunches.mjs   # pick the lunch per day -> lunches.json (default: "Oběd 1")
node choose.mjs    # optional: override the default on days with two lunches
node ingredients.mjs  # Gemini splits lunches into ingredients -> ingredients.json (needs GEMINI_API_KEY in .env)
node match.mjs        # match ingredients to Kalorické tabulky foods -> matches.json (read-only, no diary writes)
node write.mjs --date YYYY-MM-DD [--write]   # write that day into the bot account diary (dry run without --write)
node send.mjs --date YYYY-MM-DD [--send]     # send that day Oběd to your main account (dry run without --send)
node daily.mjs [--go]                        # the whole chain for today in one command (dry run without --go)
```

## Planned

- Read the real orders from eStrava after login (credentials in `.env`, never committed).
- AI step: split each lunch into ingredients, then match them to Kalorické tabulky.
- Popup on startup via Task Scheduler.
