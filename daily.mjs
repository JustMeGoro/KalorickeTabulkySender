// Runs the whole pipeline for one day:
//   menu -> lunches -> ingredients -> match -> write to the bot diary -> send to your main account
//
//   node daily.mjs                  dry run for today: runs the read-only steps, shows what would be written/sent
//   node daily.mjs --go             really write and send today's lunch
//   node daily.mjs --date 2026-10-14 [--go]
//
// Days already sent (sent.json) are skipped, and days without a lunch (weekends, holidays) are ignored.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const GO = args.includes("--go");
const i = args.indexOf("--date");
const today = new Date();
const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
const date = i >= 0 ? args[i + 1] : localToday;

function step(title, script, scriptArgs = []) {
  console.log(`\n=== ${title} ===`);
  const r = spawnSync(process.execPath, [script, ...scriptArgs], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nStep "${title}" failed (exit ${r.status}) - stopping.`);
    process.exit(r.status ?? 1);
  }
}

console.log(`Day: ${date}  (${GO ? "REAL RUN" : "dry run, add --go to write and send"})`);

step("Download menu", "scrape.mjs");
step("Pick lunches", "lunches.mjs");

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
if (!lunches.some((l) => l.date === date)) {
  console.log(`\nNo lunch on ${date} - nothing to do.`);
  process.exit(0);
}

const sent = await readFile("sent.json", "utf8").then(JSON.parse, () => ({}));
if (sent[date]) {
  console.log(`\n${date} was already sent on ${sent[date]} - nothing to do.`);
  process.exit(0);
}

step("Ingredients (Gemini)", "ingredients.mjs");
step("Match to Kalorické tabulky", "match.mjs");
step("Write to the diary", "write.mjs", ["--date", date, ...(GO ? ["--write"] : [])]);
step("Send to the main account", "send.mjs", ["--date", date, ...(GO ? ["--send"] : [])]);

console.log(GO ? `\nAll done for ${date}.` : `\nDry run finished. Run again with --go to do it for real.`);
