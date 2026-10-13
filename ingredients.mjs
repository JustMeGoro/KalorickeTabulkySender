// Splits each lunch from lunches.json into ingredients with estimated weights using the Gemini API.
// Results are cached by meal name in ingredients.json, so each meal is only sent once.
// Needs GEMINI_API_KEY in .env. Set GEMINI_MODEL in .env to change the model.
import { readFile, writeFile } from "node:fs/promises";

try {
  process.loadEnvFile(".env");
} catch {
  // .env is optional if the variables are already set in the environment
}
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) throw new Error("GEMINI_API_KEY is missing - put it in .env");
// Free-tier models are often overloaded (503), so fall back through several. GEMINI_MODEL overrides the first.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.5-flash", "gemini-flash-latest", "gemini-3.1-flash-lite"].filter(Boolean);
const endpoint = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function askGemini(name) {
  const body = {
    contents: [{ parts: [{ text: PROMPT(name) }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.2 },
  };
  for (let attempt = 0; attempt < MODELS.length * 3; attempt++) {
    const model = MODELS[attempt % MODELS.length];
    const res = await fetch(endpoint(model), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify(body),
    });
    if (res.status === 429 || res.status >= 500) {
      console.warn(`  ${model}: HTTP ${res.status}, trying next model`);
      await sleep(2000);
      continue;
    }
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`Empty Gemini response for "${name}"`);
    return JSON.parse(text).ingredients;
  }
  throw new Error(`Gemini kept failing for "${name}"`);
}

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const cache = await readFile("ingredients.json", "utf8").then(JSON.parse, () => ({ meals: {} }));

const today = new Date().toISOString().slice(0, 10);
const names = [...new Set(lunches.filter((l) => l.date >= today).map((l) => l.name))];
const todo = names.filter((n) => !cache.meals[n]);
console.log(`${names.length} upcoming meals, ${todo.length} new`);

for (const [i, name] of todo.entries()) {
  console.log(`[${i + 1}/${todo.length}] ${name}`);
  cache.meals[name] = await askGemini(name);
  await writeFile("ingredients.json", JSON.stringify(cache, null, 2) + "\n", "utf8");
  await sleep(1500);
}

console.log("Done: ingredients.json");
