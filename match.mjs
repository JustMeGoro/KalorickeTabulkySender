// Matches every ingredient from ingredients.json to a food in the Kalorické tabulky database.
// Search uses the public autocomplete endpoint (no login). When there are several candidates
// ("kuřecí prsa" -> syrová / grilovaná / restovaná ...), Gemini picks the best one.
// Results are cached by ingredient name in matches.json - delete an entry to redo it,
// or edit it by hand to force a specific food. This script never writes to your diary.
import { readFile, writeFile } from "node:fs/promises";
import { generateJson, sleep } from "./gemini.mjs";

const SEARCH = "https://www.kaloricketabulky.cz/autocomplete/foodstuff-meal";
const MAX_CANDIDATES = 12;

async function search(query) {
  const res = await fetch(`${SEARCH}?query=${encodeURIComponent(query)}&format=json`);
  if (!res.ok) throw new Error(`Search HTTP ${res.status} for "${query}"`);
  const items = await res.json();
  return items
    .filter((i) => i.clazz === "foodstuff")
    .map((i) => ({ id: i.id, url: i.url, title: i.title, unit: i.unit, kcalPer100: Number(i.value) }));
}

// Try the full name first, then drop words from the end ("brambory vařené" -> "brambory").
async function findCandidates(name) {
  const words = name.split(" ");
  for (let n = words.length; n >= 1; n--) {
    const found = await search(words.slice(0, n).join(" "));
    if (found.length) return found.slice(0, MAX_CANDIDATES);
  }
  return [];
}

const PICK_SCHEMA = {
  type: "OBJECT",
  properties: { choice: { type: "INTEGER" }, reason: { type: "STRING" } },
  required: ["choice", "reason"],
};

async function pick(name, candidates) {
  const list = candidates.map((c, i) => `${i}: ${c.title} (${c.kcalPer100} kcal/100 ${c.unit})`).join("\n");
  const prompt = `Vybírám potravinu z databáze kalorických tabulek pro surovinu ze školního oběda.
Surovina: "${name}". Gramáž je odhadnutá pro hotové, uvařené jídlo, takže preferuj vařenou/upečenou/hotovou variantu před syrovou, pokud o syrovou nejde.
Preferuj obecné položky před značkovými výrobky.
Kandidáti:
${list}

Vrať index nejlepšího kandidáta jako choice, nebo -1, pokud žádný nevyhovuje. Do reason napiš důvod jednou větou.`;
  return generateJson(prompt, PICK_SCHEMA);
}

const ingredients = JSON.parse(await readFile("ingredients.json", "utf8"));
const matches = await readFile("matches.json", "utf8").then(JSON.parse, () => ({}));

const names = [...new Set(Object.values(ingredients.meals).flat().map((i) => i.name))];
const todo = names.filter((n) => !matches[n]);
console.log(`${names.length} ingredients, ${todo.length} to match`);

for (const [i, name] of todo.entries()) {
  const candidates = await findCandidates(name);
  let entry;
  if (candidates.length === 0) {
    entry = { status: "not_found" };
  } else if (candidates.length === 1) {
    entry = { status: "ok", ...candidates[0], reason: "only candidate" };
  } else {
    const { choice, reason } = await pick(name, candidates);
    const chosen = candidates[choice];
    entry = chosen ? { status: "ok", ...chosen, reason } : { status: "no_match", reason, candidates: candidates.map((c) => c.title) };
    await sleep(1500);
  }
  matches[name] = entry;
  console.log(`[${i + 1}/${todo.length}] ${name} -> ${entry.status === "ok" ? `${entry.title} (${entry.kcalPer100} kcal/100 g)` : entry.status}`);
  await writeFile("matches.json", JSON.stringify(matches, null, 2) + "\n", "utf8");
}

// Sanity check: estimated kcal per meal.
console.log("\nEstimated kcal per meal:");
for (const [meal, items] of Object.entries(ingredients.meals)) {
  let kcal = 0;
  const missing = [];
  for (const it of items) {
    const m = matches[it.name];
    if (m?.status === "ok") kcal += (it.grams * m.kcalPer100) / 100;
    else missing.push(it.name);
  }
  console.log(`  ${Math.round(kcal)} kcal  ${meal}${missing.length ? `   (unmatched: ${missing.join(", ")})` : ""}`);
}
