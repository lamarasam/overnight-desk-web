// Service worker: web push only (home-screen app). No caching: the desk's numbers are never served stale.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { d = { title: "Grok Bot", body: event.data ? event.data.text() : "" }; }
  const title = d.title || "Grok Bot · now";
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: d.url || null },            // a FOMO link from the desk's data (links.py), never built here
    actions: (d.actions || []).slice(0, 2),
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data && event.notification.data.url;
  event.waitUntil((async () => {
    if (url && /^https:\/\//.test(url)) { await self.clients.openWindow(url); return; }
    const all = await self.clients.matchAll({ type: "window" });
    if (all.length) return all[0].focus();
    return self.clients.openWindow("./");
  })());
});
