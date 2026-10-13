// Interactive lunch picker. For days with several main meals, asks which one you eat.
// Saves picks to selection.json ({ "2026-10-01": "Oběd 1" }); already-picked days are skipped
// unless you pass --all. Days with a single main meal are picked automatically.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const menu = JSON.parse(await readFile("menu.json", "utf8"));
const selection = await readFile("selection.json", "utf8").then(JSON.parse, () => ({}));
const redo = process.argv.includes("--all");
const today = new Date().toISOString().slice(0, 10);

const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
const ask = async (q) => { process.stdout.write(q); const r = await lines.next(); return r.done ? "" : r.value; };
const fmt = new Intl.DateTimeFormat("cs-CZ", { weekday: "long", day: "numeric", month: "numeric" });

for (const day of menu.days) {
  const mains = day.meals.filter((m) => m.type === "main");
  if (mains.length === 0 || day.date < today) { delete selection[day.date]; continue; }
  if (mains.length === 1) { selection[day.date] = mains[0].slot; continue; }

  const known = mains.some((m) => m.slot === selection[day.date]);
  if (known && !redo) continue;

  console.log(`\n${fmt.format(new Date(day.date))} (${day.date})`);
  mains.forEach((m, i) => console.log(`  ${i + 1}) ${m.slot}: ${m.name}`));
  const ans = (await ask(`Choice [1-${mains.length}], Enter = skip: `)).trim();
  const pick = mains[Number(ans) - 1];
  if (pick) selection[day.date] = pick.slot;
  else delete selection[day.date];
}
rl.close();

await writeFile("selection.json", JSON.stringify(selection, null, 2) + "\n", "utf8");
console.log(`\nSaved selection.json (${Object.keys(selection).length} days)`);
