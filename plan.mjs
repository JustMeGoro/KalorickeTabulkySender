// What exactly goes into the diary for one day: the menu ingredients (grams corrected from the photo),
// extra foods seen on the tray, and the user's answers to "is this part of your lunch?".
//
// portions.json  { "<date>": { meal, photoHash, createdAt, items: [{name, grams}],
//                              extras: [{ id, name, grams, confident, box, note }],
//                              notified, closed } }
// answers/<date>.json  written by the phone app: { "<extra id>": { action: "add" | "skip", name, grams } }
//
// An extra seen with confidence is added by itself; an unsure one is only added when the user says "add".
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const readJson = (path, fallback) => readFile(path, "utf8").then(JSON.parse, () => fallback);

export const readPortions = () => readJson("portions.json", {});
export const writePortions = (all) => writeFile("portions.json", JSON.stringify(all, null, 2) + "\n", "utf8");
export const readAnswers = (date) => readJson(`answers/${date}.json`, null);
export const hashFile = (bytes) => createHash("sha256").update(bytes).digest("hex").slice(0, 16);

// Extras the user still has to decide about (unsure ones without an answer).
export function openQuestions(entry, answers) {
  if (!entry || entry.closed) return [];
  return (entry.extras ?? []).filter((e) => !e.confident && !answers?.[e.id]);
}

// Final list for the diary: [{ name, grams }]
export async function finalItems(date) {
  const entry = (await readPortions())[date];
  if (!entry) return null;
  const answers = await readAnswers(date);
  const items = [...entry.items];
  for (const e of entry.extras ?? []) {
    const answer = answers?.[e.id];
    if (e.confident && answer?.action !== "skip") items.push({ name: answer?.name || e.name, grams: Number(answer?.grams) || e.grams, extra: true });
    else if (!e.confident && answer?.action === "add") items.push({ name: answer.name || e.name, grams: Number(answer.grams) || e.grams, extra: true });
  }
  return items;
}

// Every ingredient name that may need a Kalorické tabulky match (menu ingredients are handled by match.mjs).
export async function extraNames() {
  const names = new Set();
  for (const [date, entry] of Object.entries(await readPortions())) {
    for (const e of entry.extras ?? []) names.add(e.name);
    const answers = await readAnswers(date);
    for (const a of Object.values(answers ?? {})) if (a?.action === "add" && a.name) names.add(a.name);
  }
  return [...names];
}

export async function closeDay(date) {
  const all = await readPortions();
  if (all[date] && !all[date].closed) {
    all[date].closed = true;
    await writePortions(all);
  }
}
