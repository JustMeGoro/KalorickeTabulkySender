// Service worker (v3): makes the page installable and shows push notifications ("is this part of your lunch?").
// It caches nothing, so the page and the lunch data are always fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Lunch", {
      body: data.body || "",
      icon: "icon-192.png",
      badge: "icon-192.png",
      tag: data.tag || "lunch",
      data: { url: data.url || "./" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows) {
        if ("focus" in w) {
          w.postMessage({ type: "open-questions" });
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
