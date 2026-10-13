// Fetches the canteen menu from the public eStrava API and writes a clean menu.json.
import { writeFile } from "node:fs/promises";

const IDZAR = 103; // Gymnázium Orlová
const URL = `https://secure.ulrichsw.cz/estrava/api/?v=1&action=publicjidelnicek&idzar=${IDZAR}&typ=2&lang=CZ`;

const res = await fetch(URL);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const api = await res.json();

const typeOf = (heading) => {
  if (/pol[eé]vka/i.test(heading)) return "soup";
  if (/další/i.test(heading)) return "drink";
  return "main";
};

// "(1.1,9)" / "(7)" / "(1.1,3,)" -> allergen codes
const ALLERGEN_RE = /\(\s*\d+(?:\.\d+)?(?:\s*,\s*\d*(?:\.\d+)?)*\s*\)/g;

const parse = (raw) => {
  const allergens = [...raw.matchAll(ALLERGEN_RE)]
    .flatMap((m) => m[0].slice(1, -1).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const name = raw.replace(ALLERGEN_RE, " ").replace(/\s+/g, " ").replace(/\s+,/g, ",").trim();
  return { name, allergens: [...new Set(allergens)] };
};

const days = api.weeks
  .flatMap((w) => w.data)
  .map((d) => ({
    date: d.datum,
    meals: d.data
      .filter((m) => m.druh === "meal")
      .map((m) => ({
        slot: m.nadpis,
        type: typeOf(m.nadpis),
        raw: m.nazev,
        ...parse(m.nazev),
      })),
  }));

const out = {
  source: URL,
  canteen: api.jidelna.nazev,
  fetchedAt: new Date().toISOString(),
  days,
};
await writeFile("menu.json", JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`Wrote menu.json: ${days.length} days`);
