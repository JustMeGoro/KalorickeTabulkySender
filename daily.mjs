// Runs the whole pipeline:
//   menu -> lunches -> ingredients -> match -> write to the bot diary -> send to your main account
//
//   node daily.mjs                      dry run for today
//   node daily.mjs --go                 really write and send today's lunch
//   node daily.mjs --week [--go]        every day with a lunch from today to Sunday
//                                       (on Saturday/Sunday: the whole next week)
//   node daily.mjs --date 2026-10-14 [--go]
//
// Days already sent (sent.json) are skipped, and days without a lunch (weekends, holidays) are ignored,
// so it is safe to run this as often as you like.
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const GO = args.includes("--go");
const WEEK = args.includes("--week");
const di = args.indexOf("--date");

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const start = di >= 0 ? new Date(`${args[di + 1]}T12:00:00`) : addDays(new Date(), 0);
let first = start;
let last = start;
if (WEEK) {
  const dow = start.getDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0 || dow === 6) first = addDays(start, dow === 6 ? 2 : 1); // next Monday
  last = addDays(first, (7 - first.getDay()) % 7); // that week's Sunday
}
const wanted = [];
for (let d = first; iso(d) <= iso(last); d = addDays(d, 1)) wanted.push(iso(d));

function step(title, script, scriptArgs = [], { fatal = true } = {}) {
  console.log(`\n=== ${title} ===`);
  const r = spawnSync(process.execPath, [script, ...scriptArgs], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`\nStep "${title}" failed (exit ${r.status}).`);
    if (fatal) process.exit(r.status ?? 1);
  }
  return r.status === 0;
}

console.log(`Days: ${wanted.join(", ")}  (${GO ? "REAL RUN" : "dry run, add --go to write and send"})`);

step("Download menu", "scrape.mjs");
step("Pick lunches", "lunches.mjs");

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const sent = await readFile("sent.json", "utf8").then(JSON.parse, () => ({}));
const todo = wanted.filter((d) => lunches.some((l) => l.date === d) && !sent[d]);
for (const d of wanted) {
  if (!lunches.some((l) => l.date === d)) console.log(`${d}: no lunch - skipped`);
  else if (sent[d]) console.log(`${d}: already sent on ${sent[d]} - skipped`);
}
if (todo.length === 0) {
  console.log("\nNothing to do.");
  process.exit(0);
}

step("Ingredients (Gemini)", "ingredients.mjs");
step("Match to Kalorické tabulky", "match.mjs");

const failed = [];
for (const date of todo) {
  const ok =
    step(`Write ${date}`, "write.mjs", ["--date", date, ...(GO ? ["--write"] : [])], { fatal: false }) &&
    step(`Send ${date}`, "send.mjs", ["--date", date, ...(GO ? ["--send"] : [])], { fatal: false });
  if (!ok) failed.push(date);
}

if (failed.length) {
  console.error(`\nFailed days: ${failed.join(", ")} - run again to retry them (finished days are skipped).`);
  process.exit(1);
}
console.log(GO ? `\nAll done: ${todo.join(", ")}.` : `\nDry run finished. Run again with --go to do it for real.`);
