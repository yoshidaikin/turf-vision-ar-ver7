const CACHE = "turf-vision-live-v150";
const ASSETS = ["./", "./index.html", "./app.js", "./ar.html", "./ar.css", "./ar.js", "./manifest.json", "./ar-manifest.json", "./ar-icons/favicon.ico", "./ar-icons/icon-192.png", "./ar-icons/icon-512.png", "./ar-icons/apple-touch-icon.png", "./ar-icons/favicon-32.png"];

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, {cache:"no-store"})
        .then(response => {
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(()=>caches.match(request).then(r=>r||caches.match("./index.html")))
    );
    return;
  }
  const url=new URL(request.url);
  if(url.pathname.endsWith("/app.js") || url.pathname.endsWith("/ar.js") || url.pathname.endsWith("/ar.css") || url.pathname.endsWith("/ar.html") || url.pathname.endsWith("/manifest.json") || url.pathname.endsWith("/ar-manifest.json") || url.pathname.includes("/ar-icons/") || url.pathname.endsWith("/sw.js")){
    event.respondWith(
      fetch(request,{cache:"no-store"})
        .then(response=>{
          const copy=response.clone();
          caches.open(CACHE).then(cache=>cache.put(request,copy));
          return response;
        })
        .catch(()=>caches.match(request))
    );
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
});
