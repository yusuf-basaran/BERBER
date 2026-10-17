/* Public offline shell only. Never persist account pages, business data or API responses. */
const CACHE='berber-shell-b23147ae2beb4953';
const OFFLINE='/cevrimdisi';
const PUSH_BODY="Yeni bir bildirimin var. Görmek için BERBER hesabına giriş yap.";
const STATIC=[OFFLINE,'/css/style.css','/css/responsive.css','/js/i18n.js','/js/offline-page.js','/assets/pwa-192.png','/assets/pwa-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC.map(path=>new Request(path,{cache:'reload',credentials:'omit'})))));});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('berber-shell-')&&key!==CACHE)await caches.delete(key);
 await self.clients.claim();
})());});
self.addEventListener('message',event=>{
 if(event.data?.type==='PUSH_CAPABILITY'&&event.source?.id){event.waitUntil((async()=>{const client=await self.clients.get(event.source.id);if(client&&new URL(client.url).origin===self.location.origin)event.ports[0]?.postMessage({supported:true});})());return;}
 if(event.data?.type!=='ACTIVATE_UPDATE'||!event.source?.id)return;
 event.waitUntil((async()=>{const client=await self.clients.get(event.source.id);if(client&&new URL(client.url).origin===self.location.origin)await self.skipWaiting();})());
});
self.addEventListener('push',event=>{
 // Kilit ekranında yalnızca genel bildirim metni gösterilir.
 event.waitUntil(self.registration.showNotification('BERBER',{body:PUSH_BODY,icon:'/assets/pwa-192.png',badge:'/assets/pwa-192.png',tag:'berber-inbox',renotify:false}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});const login=windows.find(client=>new URL(client.url).origin===self.location.origin&&/^\/giris(?:\.html)?$/.test(new URL(client.url).pathname));if(login)await login.focus();else await self.clients.openWindow('/giris.html');})());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 // Cross-origin requests never enter Cache Storage. Supabase uses the network even with an HTTP cache.
 if(url.origin!==self.location.origin){if(url.hostname==='tyxtpfykgitqfhqjkayn.supabase.co')event.respondWith(fetch(request,{cache:'no-store'}));return;}
 if(request.mode==='navigate'&&request.method==='GET'){
  event.respondWith(fetch(request,{cache:'no-store'}).catch(async()=>{
   const cached=await (await caches.open(CACHE)).match(OFFLINE);
   if(!cached)return Response.error();
   return new Response(cached.body,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-BERBER-Offline':'1'}});
  }));return;
 }
 if(request.method!=='GET'||request.headers.has('Authorization')||request.headers.has('Range')||url.search||!STATIC.includes(url.pathname)){
  event.respondWith(fetch(request,{cache:'no-store'}));return;
 }
 // Explicit allowlist only; runtime responses for these same public files can refresh the shell.
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{const response=await fetch(request,{cache:'no-store'});if(response.ok&&response.type==='basic')event.waitUntil(cache.put(url.pathname,response.clone()).catch(()=>{}));return response;}
  catch{const cached=await cache.match(url.pathname);if(cached)return cached;throw new TypeError('Offline');}
 })());
});
