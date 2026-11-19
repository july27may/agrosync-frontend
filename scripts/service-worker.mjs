import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const files = (await readdir('dist', { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile() && entry.name !== 'sw.js')
  .map(entry => '/' + `${entry.parentPath}/${entry.name}`.replace(/^dist\//, ''))
  .sort()
const hash = createHash('sha256')
for (const file of files) {
  hash.update(file).update(await readFile('dist' + file))
}
const version = hash.digest('hex').slice(0, 16)
await writeFile('dist/sw.js', `
const CACHE = 'agrosync-shell-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('agrosync-shell-') && key !== CACHE)
    .map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(caches.open(CACHE).then(async cache => fetch(event.request, { cache: 'no-store' }).catch(async () => (await cache.match('/index.html')) || Response.error())));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(event.request)));
  }
});
`)
