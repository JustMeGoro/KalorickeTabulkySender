// Sends the Oběd of one day from the bot account to your main account
// (same as: Oběd -> share -> pick a person, in the Kalorické tabulky web app).
//
//   node send.mjs --date 2026-10-14            dry run: login + show what WOULD be sent and to whom
//   node send.mjs --date 2026-10-14 --send     really send it
//
// Needs KT_EMAIL, KT_PASSWORD (bot account) and KT_SEND_TO (comma-separated e-mails of the people who
// should receive it) in .env. Each recipient must be one of the bot account's connected people; anyone
// who is not is reported and skipped. Who already got which day is remembered in sent.json.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { markSent, parseRecipients, sentAt } from "./recipients.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional if the variables are already set in the environment
}

const BASE = "https://www.kaloricketabulky.cz";
const LUNCH_TIME_ID = "3"; // "Oběd" in the diary

const args = process.argv.slice(2);
const isoDate = args[args.indexOf("--date") + 1];
const SEND = args.includes("--send");
const AGAIN = args.includes("--again"); // send even if this day was already sent
if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) {
  console.error("Usage: node send.mjs --date YYYY-MM-DD [--send]");
  process.exit(1);
}
const [y, m, d] = isoDate.split("-");
const ktDate = `${d}.${m}.${y}`;

const { KT_EMAIL, KT_PASSWORD, KT_SEND_TO } = process.env;
if (!KT_EMAIL || !KT_PASSWORD) throw new Error("KT_EMAIL / KT_PASSWORD are missing - put them in .env");
const RECIPIENTS = parseRecipients(KT_SEND_TO);
if (!RECIPIENTS.length) throw new Error("KT_SEND_TO is missing - put the e-mail(s) of the receiving accounts in .env, comma-separated");

// ---- tiny HTTP client with a cookie jar --------------------------------------------------
const jar = new Map();
const storeCookies = (res) => {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
};
async function http(path, { method = "GET", json } = {}) {
  const headers = { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), Accept: "application/json, text/plain, */*" };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(BASE + path, { method, headers, body: json === undefined ? undefined : JSON.stringify(json), redirect: "manual" });
  storeCookies(res);
  return res;
}

// ---- login ----------------------------------------------------------------------------
await http("/login");
const md5 = createHash("md5").update(KT_PASSWORD).digest("hex");
const login = await (await http("/login/create?=&format=json&voucher=false", { method: "POST", json: { email: KT_EMAIL, password: md5 } })).json();
if (login.code !== 0) throw new Error(`Login failed: ${login.message ?? "unknown error"}`);
console.log("Logged in.");

// ---- the share form ---------------------------------------------------------------------
const loadForm = async () => {
  const formRes = await (await http(`/user/settings/share/item/diary-time/form/${ktDate}/${LUNCH_TIME_ID}?format=json`)).json();
  if (formRes.code !== 0) throw new Error(`Share form failed: ${formRes.message}`);
  return formRes.data;
};

const first = await loadForm();
console.log(`\nOběd ${ktDate}`);
for (const f of first.foodstuff ?? []) console.log(`  ${f.count ?? ""} ${f.title ?? ""}`.trimEnd());
console.log(`  ${first.foodstuff?.length ?? 0} items`);
if (!first.foodstuff?.length) throw new Error(`Oběd on ${ktDate} is empty - run write.mjs first`);

const sent = await readFile("sent.json", "utf8").then(JSON.parse, () => ({}));
const failed = [];

for (const recipient of RECIPIENTS) {
  const done = sentAt(sent[isoDate], recipient);
  if (done && !AGAIN) {
    console.log(`\n${recipient}: already sent on ${done} - skipped (use --again to force).`);
    continue;
  }

  // a fresh form per recipient, with the recipient picked from the people connected to the bot account
  const form = await loadForm();
  const option = form.identifierOptions?.find((o) => o.userFromIdentifier?.toLowerCase() === recipient.toLowerCase());
  if (!option) {
    const known = (form.identifierOptions ?? []).map((o) => o.userFromIdentifier).join(", ") || "none";
    console.error(`\n${recipient}: not one of the bot account's connected people (available: ${known}) - not sending`);
    failed.push(recipient);
    continue;
  }
  form.guidUserTo = option.userFromId;
  console.log(`\n-> ${option.userFromIdentifier}`);

  if (!SEND) {
    console.log("   dry run - nothing sent");
    continue;
  }

  // ---- send ---------------------------------------------------------------------------
  const res = await (await http("/user/settings/share/item/diary-time?format=json", { method: "POST", json: form })).json();
  if (res.code !== 0) {
    console.error(`   Sending failed: ${res.message}`);
    failed.push(recipient);
    continue;
  }
  markSent(sent, isoDate, option.userFromIdentifier);
  await writeFile("sent.json", JSON.stringify(sent, null, 2) + "\n", "utf8");
  console.log(`   Sent. ${res.message ?? ""}`.trim());
}

if (!SEND) console.log("\nDry run - nothing sent. Add --send to send it.");
if (failed.length) {
  console.error(`\nFailed for: ${failed.join(", ")}`);
  process.exit(1);
}
