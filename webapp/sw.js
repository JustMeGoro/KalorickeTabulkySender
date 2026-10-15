// Minimal service worker: lets browsers treat the page as an installable app. It caches nothing,
// so the page and the lunch data are always fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
