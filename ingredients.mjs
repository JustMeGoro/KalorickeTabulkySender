// Splits each lunch from lunches.json into ingredients with estimated weights using the Gemini API.
// Results are cached by meal name in ingredients.json, so each meal is only sent once.
// Needs GEMINI_API_KEY in .env. Set GEMINI_MODEL in .env to change the model.
import { readFile, writeFile } from "node:fs/promises";
import { generateJson, sleep } from "./gemini.mjs";

const PROMPT = (name) => `Jsi nutriční asistent. Rozlož tento školní oběd na jednotlivé suroviny, jak bys je zadal do kalorických tabulek.
Pro každou surovinu uveď:
- name: český název jedné obecné suroviny (např. "hovězí maso", "brambory vařené", "rýže vařená", "mrkev"), bez přívlastků jako "po burgundsku",
- grams: odhad hmotnosti v gramech, v jaké je v typické porci obědu pro studenta střední školy (v hotovém, tedy uvařeném stavu).
Zahrň i podstatné přísady jako omáčka, olej, máslo nebo smetana, ale ne sůl a koření.

Oběd: ${name}`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    ingredients: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { name: { type: "STRING" }, grams: { type: "NUMBER" } },
        required: ["name", "grams"],
      },
    },
  },
  required: ["ingredients"],
};

const askGemini = async (name) => (await generateJson(PROMPT(name), SCHEMA)).ingredients;

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const cache = await readFile("ingredients.json", "utf8").then(JSON.parse, () => ({ meals: {} }));

// --date YYYY-MM-DD also processes that (past) day, e.g. for testing with an old photo
const ONLY_DATE = process.argv[process.argv.indexOf("--date") + 1];
const today = new Date().toISOString().slice(0, 10);
const names = [...new Set(lunches.filter((l) => l.date >= today || l.date === ONLY_DATE).map((l) => l.name))];
const todo = names.filter((n) => !cache.meals[n]);
console.log(`${names.length} upcoming meals, ${todo.length} new`);

for (const [i, name] of todo.entries()) {
  console.log(`[${i + 1}/${todo.length}] ${name}`);
  cache.meals[name] = await askGemini(name);
  await writeFile("ingredients.json", JSON.stringify(cache, null, 2) + "\n", "utf8");
  await sleep(1500);
}

console.log("Done: ingredients.json");
