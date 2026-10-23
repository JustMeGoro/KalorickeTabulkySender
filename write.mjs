// Writes one day's lunch (all ingredients, with grams) into the Oběd section of the
// Kalorické tabulky diary of the bot account.
//
//   node write.mjs --date 2026-10-14            dry run: login + show what WOULD be written
//   node write.mjs --date 2026-10-14 --write    really write it
//   add --force to write even when Oběd on that day already has entries
//
// Needs KT_EMAIL and KT_PASSWORD (bot account) in .env. Never sends anything to other users.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { finalItems, readPortions } from "./plan.mjs";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional if the variables are already set in the environment
}

const BASE = "https://www.kaloricketabulky.cz";
const LUNCH_TIME_ID = "3"; // "Oběd" in the diary

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const isoDate = argValue("--date");
const WRITE = args.includes("--write");
const FORCE = args.includes("--force");
if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) {
  console.error("Usage: node write.mjs --date YYYY-MM-DD [--write] [--force]");
  process.exit(1);
}
const [y, m, d] = isoDate.split("-");
const ktDate = `${d}.${m}.${y}`;

const { KT_EMAIL, KT_PASSWORD } = process.env;
if (!KT_EMAIL || !KT_PASSWORD) throw new Error("KT_EMAIL / KT_PASSWORD are missing - put them in .env");

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
async function api(path, opts) {
  const res = await http(path, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  const body = await res.json();
  if (body.code !== 0) throw new Error(`API error for ${path}: ${body.message ?? JSON.stringify(body).slice(0, 200)}`);
  return body.data;
}

// ---- login ----------------------------------------------------------------------------
await http("/login"); // gets the session cookie
const md5 = createHash("md5").update(KT_PASSWORD).digest("hex");
const login = await (await http("/login/create?=&format=json&voucher=false", { method: "POST", json: { email: KT_EMAIL, password: md5 } })).json();
if (login.code !== 0) throw new Error(`Login failed: ${login.message ?? "unknown error"}`);
console.log("Logged in.");

// ---- plan: what should be written -------------------------------------------------------
const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const lunch = lunches.find((l) => l.date === isoDate);
if (!lunch) throw new Error(`No lunch for ${isoDate} in lunches.json`);
const estimated = JSON.parse(await readFile("ingredients.json", "utf8")).meals[lunch.name];
if (!estimated) throw new Error(`No ingredients for "${lunch.name}" - run node ingredients.mjs`);
// amounts from the lunch photo (portion.mjs) win over the plain estimates; they also bring extra food seen
// on the tray and the user's answers (plan.mjs)
const fromPhoto = (await readPortions())[isoDate]?.meal === lunch.name ? await finalItems(isoDate) : null;
const ingredients = fromPhoto ?? estimated;
if (fromPhoto) console.log(`Using gram amounts from the lunch photo${fromPhoto.some((i) => i.extra) ? ` (including ${fromPhoto.filter((i) => i.extra).map((i) => i.name).join(", ")})` : ""}.`);
const matches = JSON.parse(await readFile("matches.json", "utf8"));

const plan = [];
for (const ing of ingredients) {
  const match = matches[ing.name];
  if (match?.status !== "ok") console.warn(`  ! skipping "${ing.name}" - no match in matches.json`);
  else plan.push({ ...ing, food: match });
}
console.log(`\n${isoDate}  ${lunch.name}`);
for (const p of plan) console.log(`  ${String(p.grams).padStart(5)} g  ${p.food.title}  (${Math.round((p.grams * p.food.kcalPer100) / 100)} kcal)`);
console.log(`  total ~${Math.round(plan.reduce((s, p) => s + (p.grams * p.food.kcalPer100) / 100, 0))} kcal`);

// ---- what is already in the diary? ---------------------------------------------------------
const lunchSection = async () => (await api(`/user/diary/${ktDate}/get?format=json`)).times.find((t) => t.id === LUNCH_TIME_ID);
const existing = (await lunchSection())?.foodstuff ?? [];
if (existing.length) {
  console.log(`\nOběd on ${ktDate} already has ${existing.length} entries: ${existing.map((e) => e.title).join(", ")}`);
  if (WRITE && !FORCE) {
    console.log("Not writing (would duplicate). Delete them in the app or use --force.");
    process.exit(0);
  }
}
if (!WRITE) {
  console.log("\nDry run - nothing written. Add --write to write it.");
  process.exit(0);
}

// ---- write ------------------------------------------------------------------------------
for (const p of plan) {
  const form = await api(`/user/foodstuff/add/form/${p.food.id}/${ktDate}/get?format=json`);
  form.diaryTimeGuid = LUNCH_TIME_ID;
  form.date = ktDate; // the form always comes back with today's date - the web UI overrides it too
  const gram = form.unitOptions.find((u) => u.multiplier === 1);
  if (gram) {
    form.unitGuid = gram.id;
    form.multiplier = String(p.grams);
  } else {
    const unit = form.unitOptions.find((u) => u.id === form.unitGuid) ?? form.unitOptions[0];
    form.unitGuid = unit.id;
    form.multiplier = String(Math.round((p.grams / unit.multiplier) * 1000) / 1000);
  }
  await api("/user/foodstuff/add?format=json&=", { method: "POST", json: form });
  console.log(`  + ${p.grams} g ${form.title}`);
}

const after = await lunchSection();
if ((after?.foodstuff?.length ?? 0) !== existing.length + plan.length) {
  throw new Error(`Expected ${existing.length + plan.length} entries in Oběd on ${ktDate}, found ${after?.foodstuff?.length ?? 0} - check the diary`);
}
console.log(`\nDone. Oběd on ${ktDate}: ${after.foodstuff.length} entries, ${after.energyTotal} kcal.`);
