// ============================================================
// indigo AI — Combined Service Worker
// Handles: Firebase Cloud Messaging + PWA App Shell Caching
// ============================================================

// ----- PWA CACHING SETUP -----
const CACHE_NAME = 'indigo-shell-v1';

// App shell assets to pre-cache on install
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

// Install: pre-cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-cache partial failure:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// Fetch: network-first for nav/API, cache-first for static assets
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never intercept API calls, auth, non-GET, or cross-origin
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    request.method !== 'GET' ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Navigation: network-first, offline fallback to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() =>
          caches.match('/').then(
            (cached) =>
              cached ||
              new Response(
                '<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>indigo AI</h2><p>You are offline. Please reconnect to continue.</p></body></html>',
                { headers: { 'Content-Type': 'text/html' } }
              )
          )
        )
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
    })
  );
});

// Notification click: open or focus the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow('/chat');
      })
  );
});

// ----- FIREBASE CLOUD MESSAGING -----
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCnDozzW2iLevr7oJ_XMriUtQ-VuX9WT54",
  authDomain: "gen-lang-client-0184415198.firebaseapp.com",
  projectId: "gen-lang-client-0184415198",
  storageBucket: "gen-lang-client-0184415198.firebasestorage.app",
  messagingSenderId: "490905726047",
  appId: "1:490905726047:web:2d1453f9d6f69cea083fea"
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Firebase background message:', payload);
  const notificationTitle = payload.notification?.title || 'indigo AI';
  const notificationOptions = {
    body: payload.notification?.body || 'You have a new notification.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192-maskable.png',
    tag: 'indigo-notification',
    renotify: true,
    data: payload.data,
    vibrate: [200, 100, 200],
  };
  self.registration.showNotification(notificationTitle, notificationOptions);
});
