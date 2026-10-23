/* Service worker: guarda só os arquivos estáticos (telas, fontes, estilos). Nenhuma resposta da API é guardada. */
const VERSAO = 'ctai-v42';
const ESTATICOS = ['/', '/unidade', '/ctai', '/css/app.css', '/js/core.js', '/js/login.js', '/js/unidade.js', '/js/ctai.js', '/js/pagina-unidade.js', '/js/documentos.js', '/js/ensinar.js', '/js/comece-aqui.js', '/js/sala-guiada.js', '/css/sala-guiada.css', '/js/usuario-form.js', '/js/rack-ia.js', '/js/gestao.js', '/js/caixa.js', '/js/mensageiro.js', '/icons/icon.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESTATICOS).catch(() => {})).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return; // dados sempre da rede
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(VERSAO).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
