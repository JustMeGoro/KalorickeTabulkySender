// Sends a push notification to the phone app (Web Push), e.g. "is this part of your lunch?".
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
    await webpush.sendNotification(sub, payload, { TTL: 6 * 3600 });
    sent++;
  } catch (e) {
    console.log(`notify: could not reach a phone (${e.statusCode ?? e.message}${e.statusCode === 410 ? " - it turned notifications off" : ""})`);
  }
}
console.log(`notify: sent to ${sent} of ${subs.length} phone(s)`);
