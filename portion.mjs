// Refines the gram amounts of one day's lunch from a photo of the plate.
//
//   node portion.mjs --date 2026-10-14
//
// Reads photos/<date>.jpg (uploaded from the phone web app), shows it to Gemini together with the
// ingredient list and its estimated grams, and stores the corrected amounts in portions.json.
// write.mjs then uses those instead of the plain estimates. Needs GEMINI_API_KEY.
import { readFile, writeFile } from "node:fs/promises";
import { generateJson } from "./gemini.mjs";

const args = process.argv.slice(2);
const isoDate = args[args.indexOf("--date") + 1];
if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate ?? "")) {
  console.error("Usage: node portion.mjs --date YYYY-MM-DD");
  process.exit(1);
}

const lunches = JSON.parse(await readFile("lunches.json", "utf8"));
const lunch = lunches.find((l) => l.date === isoDate);
if (!lunch) throw new Error(`No lunch for ${isoDate} in lunches.json`);
const estimate = JSON.parse(await readFile("ingredients.json", "utf8")).meals[lunch.name];
if (!estimate) throw new Error(`No ingredients for "${lunch.name}" - run node ingredients.mjs`);

const photo = await readFile(`photos/${isoDate}.jpg`).catch(() => null);
if (!photo) throw new Error(`photos/${isoDate}.jpg not found`);

const prompt = `The photo shows a school lunch on a plate: "${lunch.name}".
The recipe has these ingredients, with a typical portion estimated in grams (cooked / as served):
${estimate.map((e) => `- ${e.name}: ${e.grams} g`).join("\n")}

Look at the photo and judge how much of each ingredient is really on the plate. For scale: it is a standard
school-canteen dinner plate about 24 cm across (a full plate like this usually holds 450-600 g of food in
total), and a fork is about 19 cm and a knife about 21 cm long. Estimate each food's volume on the plate
against those sizes and convert it to grams (cooked potatoes are about 0.8 g/cm3 when piled, sauces about 1 g/cm3). Return EVERY ingredient from the list, with exactly the same name, and its
grams as served on this plate. If an ingredient is not visible (a sauce soaked into something, oil, spices),
keep it close to the estimate. Whole numbers only.`;

const schema = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { name: { type: "STRING" }, grams: { type: "NUMBER" } },
    required: ["name", "grams"],
  },
};

console.log(`${isoDate}  ${lunch.name}  (photo ${Math.round(photo.length / 1024)} kB)`);
const answer = await generateJson(prompt, schema, [{ mimeType: "image/jpeg", data: photo.toString("base64") }]);

// Guard against nonsense: stay between a quarter and 2.5x of the estimate; unknown names are ignored.
const items = estimate.map((e) => {
  const got = answer.find((a) => a.name === e.name);
  let grams = got ? Math.round(got.grams) : e.grams;
  const clamped = Math.min(Math.max(grams, Math.round(e.grams * 0.25)), Math.round(e.grams * 2.5));
  if (clamped !== grams) console.warn(`  ! ${e.name}: ${grams} g looks off, using ${clamped} g`);
  grams = clamped;
  console.log(`  ${String(grams).padStart(5)} g  ${e.name}  (estimate ${e.grams} g)`);
  return { name: e.name, grams };
});

const portions = await readFile("portions.json", "utf8").then(JSON.parse, () => ({}));
portions[isoDate] = { meal: lunch.name, createdAt: new Date().toISOString(), items };
await writeFile("portions.json", JSON.stringify(portions, null, 2) + "\n", "utf8");
console.log("Saved portions.json");
