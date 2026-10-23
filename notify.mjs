// Sends a notification to the phone, e.g. "is this part of your lunch?".
//   - NTFY_TOPIC set: through the free ntfy app (https://ntfy.sh), whose notifications pop up on screen on Samsung.
//     The topic name works like a password, so it is a GitHub secret. Tapping the notification opens the app.
//   - otherwise: Web Push to the installed web app (below). Samsung shows these only in the notification shade.
//
//   node notify.mjs --title "Lunch" --body "Is the bread on your tray part of your lunch?" [--url ./?q=1]
//
// Needs the `web-push` package (npm install in the workflow), the VAPID private key in VAPID_PRIVATE_KEY, and
// the phones that enabled notifications in the app (push/subscriptions.json, written by the app).
// The public key is not secret: push/vapid-public.txt. Missing pieces only print a note and exit 0, so a
// notification problem never fails a lunch run.
import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const arg = (name, fallback = "") => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

const APP_URL = process.env.APP_URL ?? "https://justmegoro.github.io/lunch-photo/";
const topic = process.env.NTFY_TOPIC?.trim();
if (topic) {
  const url = arg("--url", "./");
  const res = await fetch(process.env.NTFY_SERVER ?? "https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic,
      title: arg("--title", "Lunch"),
      message: arg("--body") || "Lunch",
      priority: 4, // high: pops up on screen with sound
      tags: ["fork_and_knife"],
      click: new URL(url, APP_URL).href,
    }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e) => ({ ok: false, status: e.message }));
  console.log(res.ok ? "notify: sent through ntfy" : `notify: ntfy failed (${res.status})`);
  process.exit(0);
}

const subs = await readFile("push/subscriptions.json", "utf8").then(JSON.parse, () => []);
const publicKey = (process.env.VAPID_PUBLIC_KEY ?? (await readFile("push/vapid-public.txt", "utf8").catch(() => ""))).trim();
const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();

if (!subs.length) {
  console.log("notify: no phone has enabled notifications yet (Settings in the app) - skipped");
  process.exit(0);
}
if (!publicKey || !privateKey) {
  console.log("notify: VAPID keys are not set (VAPID_PRIVATE_KEY secret) - skipped");
  process.exit(0);
}

let webpush;
try {
  webpush = (await import("web-push")).default;
} catch {
  console.log("notify: the web-push package is not installed - skipped");
  process.exit(0);
}
webpush.setVapidDetails("mailto:lunch-bot@users.noreply.github.com", publicKey, privateKey);

const payload = JSON.stringify({ title: arg("--title", "Lunch"), body: arg("--body"), url: arg("--url", "./"), tag: arg("--tag", "lunch") });
let sent = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub, payload, { TTL: 6 * 3600, urgency: "high" });
    sent++;
  } catch (e) {
    console.log(`notify: could not reach a phone (${e.statusCode ?? e.message}${e.statusCode === 410 ? " - it turned notifications off" : ""})`);
  }
}
console.log(`notify: sent to ${sent} of ${subs.length} phone(s)`);
