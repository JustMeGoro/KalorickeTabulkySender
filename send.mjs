// Sends the Oběd of one day from the bot account to your main account
// (same as: Oběd -> share -> pick a person, in the Kalorické tabulky web app).
//
//   node send.mjs --date 2026-10-14            dry run: login + show what WOULD be sent and to whom
//   node send.mjs --date 2026-10-14 --send     really send it
//
// Needs KT_EMAIL, KT_PASSWORD (bot account) and KT_SEND_TO (the e-mail of the account that
// should receive it) in .env. If the recipient in the form is not KT_SEND_TO, nothing is sent.
import { createHash } from "node:crypto";

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
if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) {
  console.error("Usage: node send.mjs --date YYYY-MM-DD [--send]");
  process.exit(1);
}
const [y, m, d] = isoDate.split("-");
const ktDate = `${d}.${m}.${y}`;

const { KT_EMAIL, KT_PASSWORD, KT_SEND_TO } = process.env;
if (!KT_EMAIL || !KT_PASSWORD) throw new Error("KT_EMAIL / KT_PASSWORD are missing - put them in .env");
if (!KT_SEND_TO) throw new Error("KT_SEND_TO is missing - put the e-mail of the receiving account in .env");

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
const formRes = await (await http(`/user/settings/share/item/diary-time/form/${ktDate}/${LUNCH_TIME_ID}?format=json`)).json();
if (formRes.code !== 0) throw new Error(`Share form failed: ${formRes.message}`);
const form = formRes.data;

const link = form.identifierOptions.find((o) => o.userFromId === form.guidUserTo);
const recipient = link?.userFromIdentifier ?? "(unknown)";
console.log(`\nOběd ${ktDate} -> ${recipient}`);
for (const f of form.foodstuff ?? []) console.log(`  ${f.count ?? ""} ${f.title ?? ""}`.trimEnd());
console.log(`  ${form.foodstuff?.length ?? 0} items`);

if (!form.foodstuff?.length) throw new Error(`Oběd on ${ktDate} is empty - run write.mjs first`);
if (recipient.toLowerCase() !== KT_SEND_TO.toLowerCase()) {
  throw new Error(`Recipient is ${recipient}, but KT_SEND_TO is ${KT_SEND_TO} - not sending`);
}
if (!SEND) {
  console.log("\nDry run - nothing sent. Add --send to send it.");
  process.exit(0);
}

// ---- send -------------------------------------------------------------------------------
const res = await (await http("/user/settings/share/item/diary-time?format=json", { method: "POST", json: form })).json();
if (res.code !== 0) throw new Error(`Sending failed: ${res.message}`);
console.log(`\nSent. ${res.message ?? ""}`.trim());
