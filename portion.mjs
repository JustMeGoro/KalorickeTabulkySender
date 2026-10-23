// Refines the gram amounts of one day's lunch from a photo of the plate, and spots extra food on the tray.
//
//   node portion.mjs --date 2026-10-14 [--force]
//
// Reads photos/<date>.jpg (uploaded from the phone web app), shows it to Gemini together with the
// ingredient list and its estimated grams, and stores in portions.json:
//   items   the menu ingredients with grams corrected from the photo
//   extras  other food on the tray that is not in the menu (bread, a roll, fruit, a dessert...). Sure ones are
//           added automatically; unsure ones become a question for the user (see plan.mjs and the app).
// Does nothing when this very photo was already processed (use --force). Needs GEMINI_API_KEY.
import { readFile } from "node:fs/promises";
import { generateJson } from "./gemini.mjs";
import { hashFile, readPortions, writePortions } from "./plan.mjs";

const args = process.argv.slice(2);
const isoDate = args[args.indexOf("--date") + 1];
const FORCE = args.includes("--force");
if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) {
  console.error("Usage: node portion.mjs --date YYYY-MM-DD [--force]");
  process.exit(1);
}

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const lunch = lunches.find((l) => l.date === isoDate);
if (!lunch) throw new Error(`No lunch for ${isoDate} in lunches.json`);
const estimate = JSON.parse(await readFile("ingredients.json", "utf8")).meals[lunch.name];
if (!estimate) throw new Error(`No ingredients for "${lunch.name}" - run node ingredients.mjs`);

const photo = await readFile(`photos/${isoDate}.jpg`).catch(() => null);
if (!photo) throw new Error(`photos/${isoDate}.jpg not found`);

const portions = await readPortions();
const photoHash = hashFile(photo);
if (!FORCE && portions[isoDate]?.photoHash === photoHash && portions[isoDate]?.meal === lunch.name) {
  console.log(`${isoDate}: this photo was already processed - keeping the portions.`);
  process.exit(0);
}

const prompt = `The photo shows a school lunch on a tray: "${lunch.name}".
The recipe has these ingredients, with a typical portion estimated in grams (cooked / as served):
${estimate.map((e) => `- ${e.name}: ${e.grams} g`).join("\n")}

TASK 1 - portions. Judge how much of each ingredient is really on the plate. For scale: it is a standard
school-canteen dinner plate about 24 cm across (a full plate like this usually holds 450-600 g of food in
total), and a fork is about 19 cm and a knife about 21 cm long. Estimate each food's volume on the plate
against those sizes and convert it to grams (cooked potatoes are about 0.8 g/cm3 when piled, sauces about 1 g/cm3).
Return EVERY ingredient from the list in "items", with exactly the same name and its grams as served on this
plate. If an ingredient is not visible (a sauce soaked into something, oil, spices), keep it close to the
estimate. Whole numbers only.

TASK 2 - extra food. Look for edible things on the tray in front of the camera that are NOT covered by the
ingredient list: for example slices of bread or a roll, fruit, a dessert, yoghurt, a salad cup, a sauce cup, a
drink. List each one in "extras" with a short Czech name that fits a calorie table (e.g. "chléb", "rohlík",
"jablko"), grams, and a bounding box [ymin, xmin, ymax, xmax] in 0-1000 coordinates of the photo.
Set "confident" to true only when it clearly is food that belongs to this person's lunch. Set it to false when
you are not sure what it is or whether it is part of the lunch. Ignore the tray, plate, cutlery, napkins,
packaging, and anything on other people's trays or in the background. If nothing extra is there, return an
empty list. Do not repeat foods that are already in the ingredient list.`;

const schema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { name: { type: "STRING" }, grams: { type: "NUMBER" } }, required: ["name", "grams"] },
    },
    extras: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          grams: { type: "NUMBER" },
          confident: { type: "BOOLEAN" },
          box: { type: "ARRAY", items: { type: "NUMBER" } },
          note: { type: "STRING" },
        },
        required: ["name", "grams", "confident", "box"],
      },
    },
  },
  required: ["items", "extras"],
};

console.log(`${isoDate}  ${lunch.name}  (photo ${Math.round(photo.length / 1024)} kB)`);
const answer = await generateJson(prompt, schema, [{ mimeType: "image/jpeg", data: photo.toString("base64") }]);

// Guard against nonsense: stay between a quarter and 2.5x of the estimate; unknown names are ignored.
const items = estimate.map((e) => {
  const got = answer.items.find((a) => a.name === e.name);
  let grams = got ? Math.round(got.grams) : e.grams;
  const clamped = Math.min(Math.max(grams, Math.round(e.grams * 0.25)), Math.round(e.grams * 2.5));
  if (clamped !== grams) console.warn(`  ! ${e.name}: ${grams} g looks off, using ${clamped} g`);
  grams = clamped;
  console.log(`  ${String(grams).padStart(5)} g  ${e.name}  (estimate ${e.grams} g)`);
  return { name: e.name, grams };
});

// Extras: sane grams, a usable box, not a repeat of a menu ingredient.
const known = new Set(estimate.map((e) => e.name.toLowerCase()));
const extras = [];
for (const x of answer.extras ?? []) {
  const name = String(x.name ?? "").trim();
  if (!name || known.has(name.toLowerCase())) continue;
  const grams = Math.min(Math.max(Math.round(x.grams), 5), 400);
  const box = Array.isArray(x.box) && x.box.length === 4 && x.box.every((n) => Number.isFinite(n)) ? x.box.map((n) => Math.min(Math.max(Math.round(n), 0), 1000)) : null;
  extras.push({ id: `x${extras.length + 1}`, name, grams, confident: Boolean(x.confident), box, note: x.note ?? "" });
  console.log(`  + extra ${x.confident ? "(sure, added automatically)" : "(UNSURE, will ask)"}: ${name} ${grams} g`);
}
if (!extras.length) console.log("  no extra food seen");

portions[isoDate] = { meal: lunch.name, photoHash, createdAt: new Date().toISOString(), items, extras };
await writePortions(portions);
console.log("Saved portions.json");
