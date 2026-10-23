# Phone notifications from a backend job - guide for another project

Written for an AI assistant (or developer) who should add "ping my phone" notifications to a different project.
It describes what was built and verified in KalorickeTabulkySender, including the mistakes, so they are not repeated.
Everything here worked on a Samsung phone (Android, Chrome, installed web app) in October 2026.

## The goal

A scheduled or event-driven backend job (here: GitHub Actions) must be able to send the user a notification
("Is this part of your lunch? Tap to answer."). Tapping it opens the web app. No server of our own, no cost.

## Two ways, pick one

| | ntfy (recommended) | Web Push (browser-native) |
|---|---|---|
| What the user installs | the free **ntfy** app (Google Play) | nothing extra, but the web app must be installed/allowed |
| Setup effort | tiny | large: service worker, VAPID keys, subscribe flow, npm package |
| Pops up as a banner on Samsung | **yes** | **no** - only lands in the notification shade, whatever the settings |
| Needs | one secret (a long random topic name) | one secret (VAPID private key) + a subscription file |
| Message visible to | anyone who knows the topic name (treat it as a password) | only the phone (encrypted) |

Start with ntfy. Build Web Push only if installing another app is not acceptable or the message is sensitive.
The real project has both, ntfy is used when its secret is set, Web Push is the fallback.

## Option 1 - ntfy (about 20 lines)

1. User installs the ntfy app, taps +, subscribes to a **long random topic name** (lowercase letters, digits, dashes,
   20+ characters, e.g. `myproject-8f3k2j...`). The default server is ntfy.sh.
2. The same name is stored as a secret in the backend (GitHub: `gh secret set NTFY_TOPIC --repo owner/repo`;
   the *user* types it, you never see or print it).
3. The job publishes with ntfy's **JSON** API (UTF-8 safe, unlike header-based publishing):

```js
const res = await fetch("https://ntfy.sh/", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    topic: process.env.NTFY_TOPIC,
    title: "Is this part of your lunch?",
    message: "chléb - 2026-10-23. Tap to answer.",
    priority: 4,                                   // 4 = high: pops up on screen with sound. 5 = urgent (longer vibration)
    click: "https://owner.github.io/app/?q=1",     // opened when the notification is tapped
    icon: "https://owner.github.io/app/icon-192.png", // optional; did NOT show on the tested phone
  }),
  signal: AbortSignal.timeout(20_000),
});
console.log(res.ok ? "sent" : `failed (${res.status})`);   // never fail the main job because of a notification
```

Notes:
- The small status-bar icon belongs to the ntfy app and cannot be changed by the sender.
- Tapping `click` opens the URL; Android normally hands it to the installed web app if the URL is inside its scope,
  otherwise it opens in the browser. Design the page so it works in both.
- If nothing arrives: topic spelled differently in the app and in the secret, or Samsung battery saver is
  sleeping ntfy (set the app's battery usage to Unrestricted).

## Option 2 - Web Push (what the project did first)

Pieces: a **service worker** in the web app, a **VAPID key pair**, a **subscription** per phone, and a sender that
uses the `web-push` npm package.

### 1. VAPID keys (generate once, no library needed)

```js
import { generateKeyPairSync } from "node:crypto";
const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const pj = publicKey.export({ format: "jwk" }), vj = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(pj.x, "base64url"), Buffer.from(pj.y, "base64url")]).toString("base64url");
const priv = vj.d;   // base64url, 43 chars
```
- The **public** key goes into the web app (and may be committed). The **private** key becomes a backend secret.
  Write it to a temp file, let the user run `gh secret set VAPID_PRIVATE_KEY --repo owner/repo < file`, then delete the file.

### 2. Service worker (`sw.js`, same folder as the page)

```js
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "App", {   // MUST show something, or Chrome shows its own generic notice
    body: data.body || "", icon: "icon-192.png", badge: "badge-96.png",
    tag: data.tag || "app", renotify: true, requireInteraction: true, vibrate: [200, 100, 200], silent: false,
    data: { url: data.url || "./" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const w of windows) if ("focus" in w) { w.postMessage({ type: "opened-from-notification" }); return w.focus(); }
    return self.clients.openWindow(url);
  }));
});
```
- **`badge` must be a transparent PNG** (e.g. 96x96, white shape on transparent). Android uses only its alpha channel;
  an opaque square becomes a solid white block in the status bar.
- Register with `navigator.serviceWorker.register("sw.js")` in the page.

### 3. Subscribing (in the web app, behind a button - permission needs a user gesture)

```js
const reg = await navigator.serviceWorker.ready;
if ((await Notification.requestPermission()) !== "granted") return;
const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC) });
// store sub.toJSON() somewhere the backend can read: here a file `push/subscriptions.json` in the repo,
// written through the GitHub contents API with the same token the app already uses.
```
`urlBase64ToBytes` converts the base64url public key to a `Uint8Array` (replace `-`/`_`, `atob`, map char codes).

### 4. Sending (backend, Node)

```js
import webpush from "web-push";                      // npm i web-push
webpush.setVapidDetails("mailto:you@example.com", PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: "./?q=1", tag }), { TTL: 6 * 3600, urgency: "high" });
```
- A `410` error means the phone turned notifications off: remove that subscription.
- `urgency: "high"` helps delivery to a sleeping phone; even so, delivery was sometimes delayed by minutes.
- In GitHub Actions run `npm ci --omit=dev` before the step and pass the secret as `VAPID_PRIVATE_KEY` in `env:`.

### 5. A local test button (very useful for debugging)

```js
const reg = await navigator.serviceWorker.ready;
await reg.showNotification("App", { body: "Local test", icon: "icon-192.png", tag: "local-test" });
```
If this shows but the server push does not, the problem is delivery; if neither shows, the phone blocks the app.
Note: Samsung rarely pops a banner over the app that is currently open, test with the app closed and the screen on.

## Mistakes and gotchas worth knowing in advance

- **Samsung never pops web notifications up**, even with "Pop on screen" ticked and alert style on. That is why ntfy won.
  Check the Android channel via long-press on the notification, gear icon.
- **"Re-run all jobs" in GitHub Actions re-uses the workflow file and code of the original commit.** After changing
  code, always start a *new* run (`gh workflow run workflow.yml -f input=value`). We lost time testing old code.
- **YAML:** an unquoted `: ` inside a `run:` value breaks the whole workflow file (it then reports "no workflow_dispatch
  trigger"). Use a block scalar (`run: |`) and pass user text through `env:` instead of `${{ inputs.x }}` in the shell line.
- **Opening the app from a notification:** the installed app may be restarted or freshly opened, so do not rely on
  in-memory state. Pass a query like `?q=1` and have the page check what is pending when it loads.
- **Never fail the main job because of a notification.** Missing keys, no subscribers or a network error should log a
  line and exit 0.
- **Secrets:** the user sets them (`gh secret set NAME --repo owner/repo`); never ask for, print or commit their values.
  A public repo is fine for the web app only if it contains no secrets; the GitHub token the app uses is typed on the
  phone and stays in `localStorage`.
- **A question that needs an answer** (this project's modal): store the open question in a file in the repo, notify, show
  a banner + modal in the app, save the answer as a file (`answers/<id>.json`) which starts the workflow again
  (`on: push: paths: ["answers/**"]`). Give the pipeline a timeout so it continues without an answer.

## Where the real code lives (KalorickeTabulkySender)

`notify.mjs` (ntfy + Web Push sender), `webapp/sw.js` (service worker), `webapp/index.html` (subscribe button, local test,
question modal), `.github/workflows/lunch.yml` (secrets as env, `test_push` input), `push/vapid-public.txt`,
`push/subscriptions.json`. The repo `CLAUDE.md` has the full project notes.
