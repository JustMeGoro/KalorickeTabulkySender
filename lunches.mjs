// Builds lunches.json: the one meal per day you actually eat.
// Default is the first main meal ("Oběd 1"); selection.json (from choose.mjs) overrides it.
import { readFile, writeFile } from "node:fs/promises";

const menu = JSON.parse(await readFile("menu.json", "utf8"));
const selection = await readFile("selection.json", "utf8").then(JSON.parse, () => ({}));

const lunches = [];
for (const day of menu.days) {
  const mains = day.meals.filter((m) => m.type === "main");
  if (mains.length === 0) continue;
  const meal = mains.find((m) => m.slot === selection[day.date]) ?? mains[0];
  lunches.push({ date: day.date, slot: meal.slot, name: meal.name });
}

await writeFile("lunches.json", JSON.stringify(lunches, null, 2) + "\n", "utf8");
console.log(`Wrote lunches.json: ${lunches.length} days`);
