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
//
// In GitHub Actions the progress is also published for the Dashboard tab of the phone app (status.mjs).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { missingRecipients, parseRecipients } from "./recipients.mjs";
import * as status from "./status.mjs";

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

// ---- output: console + the dashboard's terminal -------------------------------------------------------
const levelOf = (text, fromStderr) => {
  if (/\b(Error|TypeError|failed|Failed|exit \d)\b/.test(text)) return "error";
  if (fromStderr || /HTTP [45]\d\d|no answer|trying next model|^\s*!/.test(text)) return "warn";
  return "info";
};
function out(text, level = "info") {
  (level === "error" ? console.error : console.log)(text);
  status.line(level, text);
}

// Runs one script and streams its output line by line. Resolves to true when it exits with 0.
function runScript(script, scriptArgs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...scriptArgs], { stdio: ["ignore", "pipe", "pipe"] });
    for (const [stream, fromStderr] of [[child.stdout, false], [child.stderr, true]]) {
      let buffer = "";
      const flush = (final) => {
        const parts = buffer.split(/\r?\n/);
        buffer = final ? "" : parts.pop();
        for (const text of final ? parts.filter(Boolean) : parts) {
          if (text.trim() || !final) out(text, levelOf(text, fromStderr));
        }
      };
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => {
        buffer += chunk;
        flush(false);
      });
      stream.on("end", () => flush(true));
    }
    child.on("close", (code) => resolve(code === 0));
    child.on("error", (e) => {
      out(`Error: could not start ${script}: ${e.message}`, "error");
      resolve(false);
    });
  });
}

const finishRun = async (state, summary, code) => {
  await status.finish(state, summary);
  process.exit(code);
};

// A pipeline step with a phase in the dashboard. On failure the cause is worked out from the terminal output.
async function step(title, script, scriptArgs, { phase, label, day = null, fatal = true }) {
  out(`\n=== ${title} ===`, "step");
  status.phase(phase, label, "running", "", day);
  const ok = await runScript(script, scriptArgs);
  if (ok) {
    status.phase(phase, label, "done", "", day);
    return true;
  }
  status.publish(); // a failure is always worth showing
  const why = status.explain(phase, status.recentLines());
  status.phase(phase, label, "failed", why.reason, day);
  status.setFailure(label, day, why);
  out(`\nStep "${title}" failed. ${why.reason}. ${why.hint}`, "error");
  if (fatal) await finishRun("failed", `${label} failed: ${why.reason}`, 1);
  return false;
}

status.setDays(wanted);
await status.init();
out(`Days: ${wanted.join(", ")}  (${GO ? "REAL RUN" : "dry run, add --go to write and send"})`);

await step("Download menu", "scrape.mjs", [], { phase: "menu", label: "Downloading the canteen menu" });
await step("Pick lunches", "lunches.mjs", [], { phase: "lunches", label: "Picking the lunch for each day" });

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const sent = await readFile("sent.json", "utf8").then(JSON.parse, () => ({}));
const pending = wanted.filter((d) => lunches.some((l) => l.date === d) && missingRecipients(sent[d], RECIPIENTS).length > 0);
for (const d of wanted) {
  if (!lunches.some((l) => l.date === d)) out(`${d}: no lunch - skipped`);
  else if (!pending.includes(d)) out(`${d}: already sent to everyone - skipped`);
  else if (sent[d]) out(`${d}: still to send to ${missingRecipients(sent[d], RECIPIENTS).join(", ")}`);
}

// Photo mode: a day is only sent once its lunch photo (photos/<date>.jpg, uploaded from the phone) exists.
// Without it the day waits until the cutoff hour of that day (then the plain estimate is sent), and a
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
    if (todo.includes(d)) {
      out(`${d}: ${hasPhoto(d) ? "photo found" : "no photo, sending the estimate"}`);
      status.phase("photo", hasPhoto(d) ? "Lunch photo received" : "No photo - using the estimate", "done", "", d);
    } else {
      out(`${d}: waiting for the lunch photo${d === today ? ` (estimate is sent at ${cutoffHour}:00 without it)` : ""}`);
    }
  }
}
// Real work starts now: from here on the dashboard follows this run.
if (todo.length > 0) status.publish();

// Break the lunches down into ingredients as soon as they are known, even for days still waiting.
const prepare = PHOTOS ? pending : todo;
if (prepare.length > 0) {
  await step("Ingredients (Gemini)", "ingredients.mjs", [], { phase: "ingredients", label: "Splitting the lunches into ingredients" });
  await step("Match to Kalorické tabulky", "match.mjs", [], { phase: "match", label: "Matching ingredients to foods" });
}
if (todo.length === 0) {
  out("\nNothing to do.");
  const waiting = pending.filter((d) => !todo.includes(d));
  await finishRun("success", waiting.length ? `Waiting for the lunch photo: ${waiting.join(", ")}` : "Nothing to do", 0);
}

const failed = [];
for (const date of todo) {
  const ok =
    (!(PHOTOS && hasPhoto(date)) ||
      (await step(`Portions from photo ${date}`, "portion.mjs", ["--date", date], { phase: "portions", label: "Reading the portions from the photo", day: date, fatal: false }))) &&
    (await step(`Write ${date}`, "write.mjs", ["--date", date, ...(GO ? ["--write"] : [])], { phase: "write", label: "Writing the foods into the diary", day: date, fatal: false })) &&
    (await step(`Send ${date}`, "send.mjs", ["--date", date, ...(GO ? ["--send"] : [])], { phase: "send", label: "Sharing the lunch", day: date, fatal: false }));
  if (!ok) failed.push(date);
}

if (failed.length) {
  out(`\nFailed days: ${failed.join(", ")} - run again to retry them (finished days are skipped).`, "error");
  await finishRun("failed", `Failed: ${failed.join(", ")}`, 1);
}
out(GO ? `\nAll done: ${todo.join(", ")}.` : `\nDry run finished. Run again with --go to do it for real.`);
await finishRun("success", GO ? `Sent ${todo.join(", ")}` : "Dry run finished", 0);
