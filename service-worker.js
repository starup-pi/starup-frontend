/* Cache only the public shell and credential-independent feed. */
"use strict";
const VERSION = "starup-v4";
const SHELL_CACHE = VERSION + "-shell";
const FEED_CACHE = VERSION + "-feed";
const FEED_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_FEED_PAGES = 10;
const SHELL = ["/", "/app.js", "/app.css", "/manifest.json", "/icon.svg", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/privacy.html"];
// Recognize the previous brand only to remove caches during upgrades and logout.
const ownsCache = (name) => name.startsWith("starup-") || name.startsWith("nexora-");
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (ownsCache(name) && ![SHELL_CACHE, FEED_CACHE].includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});
async function saveFeed(cache, key, response) {
  if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return;
  if (!response.headers.get("cache-control")?.includes("public")) return;
  const headers = new Headers(response.headers);
  headers.set("X-StarUP-Cached-At", String(Date.now()));
  await cache.put(key, new Response(await response.clone().arrayBuffer(), { status: response.status, headers }));
  const keys = await cache.keys();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_FEED_PAGES))) await cache.delete(old);
}
function feedKey(url) {
  return new Request(url.href, { credentials: "omit" });
}
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== "GET") return;
  if (url.pathname === "/api/v1/feed/") {
    const refresh = (async () => {
      const response = await fetch(url.href, { credentials: "omit", cache: "no-store" });
      const cache = await caches.open(FEED_CACHE);
      await saveFeed(cache, feedKey(url), response);
      return response;
    })();
    event.waitUntil(refresh.then(() => undefined).catch(() => undefined));
    event.respondWith((async () => {
      const cache = await caches.open(FEED_CACHE);
      const saved = await cache.match(feedKey(url));
      if (saved && Date.now() - Number(saved.headers.get("X-StarUP-Cached-At") || 0) < FEED_TTL_MS) return saved;
      if (saved) await cache.delete(feedKey(url));
      try { return await refresh; }
      catch {
        return new Response(JSON.stringify({
          code: "offline", message: "Nenhuma cópia recente da vitrine está disponível.",
          fields: {}, request_id: null
        }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
      }
    })());
    return;
  }
  // Every private API request passes directly to the network and never enters CacheStorage.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) return;
  if (SHELL.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(url.pathname).then((saved) => saved || fetch(event.request)));
  }
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") self.skipWaiting();
  if (event.data?.type === "CLEAR_PRIVATE_DATA") {
    event.waitUntil((async () => {
      for (const name of await caches.keys()) {
        if (ownsCache(name) && name !== SHELL_CACHE) await caches.delete(name);
      }
    })());
  }
});
self.addEventListener("push", (event) => {
  // Ignore arbitrary payload URLs/text: notifications never reveal identity or content.
  event.waitUntil(self.registration.showNotification("StarUP", {
    body: "Há uma atualização na plataforma.", icon: "/icon.svg", tag: "starup-update"
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: "window", includeUncontrolled: true })) {
      if (new URL(client.url).origin === self.location.origin) { await client.focus(); return; }
    }
    await self.clients.openWindow("/");
  })());
});
