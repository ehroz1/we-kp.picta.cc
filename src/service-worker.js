/*
 * Офлайн-доступ: приложение — один самодостаточный index.html (шрифты,
 * логотип и иконки уже вшиты), так что кешировать нужно только саму
 * страницу. Сеть в приоритете — чтобы подтягивать свежую версию, кеш —
 * подстраховка без интернета.
 *
 * Поменялась логика сервис-воркера — увеличь номер в CACHE.
 */
const CACHE = 'wekp-maker-v1';
const CORE = ['./', './index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
