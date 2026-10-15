// Runs the whole pipeline:
//   menu -> lunches -> ingredients -> match -> write to the bot diary -> send to your main account
//
//   node daily.mjs                      dry run for today
//   node daily.mjs --go                 really write and send today's lunch
//   node daily.mjs --week [--go]        every day with a lunch from today to Sunday
//                                       (on Saturday/Sunday: the whole next week)
//   node daily.mjs --date 2026-10-14 [--go]
//   add --photos to hold each day back until its lunch photo (photos/<date>.jpg) exists, and to take the
//   gram amounts from that photo; without one the estimate is sent at CUTOFF_HOUR (default 20) that day.
//
// Days already sent (sent.json) are skipped, and days without a lunch (weekends, holidays) are ignored,
// so it is safe to run this as often as you like.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { missingRecipients, parseRecipients } from "./recipients.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional if the variables are already set in the environment
}
const RECIPIENTS = parseRecipients(process.env.KT_SEND_TO);
if (!RECIPIENTS.length) {
  console.error("KT_SEND_TO is empty - put the recipients' e-mails (comma-separated) in .env");
  process.exit(1);
}

const args = process.argv.slice(2);
const GO = args.includes("--go");
const WEEK = args.includes("--week");
const PHOTOS = args.includes("--photos"); // wait for the lunch photo before sending (see below)
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
const pending = wanted.filter((d) => lunches.some((l) => l.date === d) && missingRecipients(sent[d], RECIPIENTS).length > 0);
for (const d of wanted) {
  if (!lunches.some((l) => l.date === d)) console.log(`${d}: no lunch - skipped`);
  else if (!pending.includes(d)) console.log(`${d}: already sent to everyone - skipped`);
  else if (sent[d]) console.log(`${d}: still to send to ${missingRecipients(sent[d], RECIPIENTS).join(", ")}`);
}

// Photo mode: a day is only sent once its lunch photo (photos/<date>.jpg, uploaded from the phone) exists.
// Without a photo it waits until the cutoff hour of that day (then the plain estimate is sent), and a
// day that is already over is sent with the estimate right away. Future days always wait.
const hasPhoto = (d) => existsSync(`photos/${d}.jpg`);
const today = iso(new Date());
const cutoffHour = Number(process.env.CUTOFF_HOUR ?? 20);
const ready = (d) => {
  if (!PHOTOS) return true;
  if (hasPhoto(d)) return true;
  if (d < today) return true;
  if (d === today && new Date().getHours() >= cutoffHour) return true;
  return false;
};
const todo = pending.filter(ready);
if (PHOTOS) {
  for (const d of pending) {
    if (todo.includes(d)) console.log(`${d}: ${hasPhoto(d) ? "photo found" : "no photo, sending the estimate"}`);
    else console.log(`${d}: waiting for the lunch photo${d === today ? ` (estimate is sent at ${cutoffHour}:00 without it)` : ""}`);
  }
}
// Break the lunches down into ingredients as soon as they are known, even for days still waiting.
const prepare = PHOTOS ? pending : todo;
if (prepare.length > 0) {
  step("Ingredients (Gemini)", "ingredients.mjs");
  step("Match to Kalorické tabulky", "match.mjs");
}
if (todo.length === 0) {
  console.log("\nNothing to do.");
  process.exit(0);
}

const failed = [];
for (const date of todo) {
  const ok =
    (!(PHOTOS && hasPhoto(date)) || step(`Portions from photo ${date}`, "portion.mjs", ["--date", date], { fatal: false })) &&
    step(`Write ${date}`, "write.mjs", ["--date", date, ...(GO ? ["--write"] : [])], { fatal: false }) &&
    step(`Send ${date}`, "send.mjs", ["--date", date, ...(GO ? ["--send"] : [])], { fatal: false });
  if (!ok) failed.push(date);
}

if (failed.length) {
  console.error(`\nFailed days: ${failed.join(", ")} - run again to retry them (finished days are skipped).`);
  process.exit(1);
}
console.log(GO ? `\nAll done: ${todo.join(", ")}.` : `\nDry run finished. Run again with --go to do it for real.`);
