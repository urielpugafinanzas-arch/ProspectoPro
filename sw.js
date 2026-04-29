// ── Versión del cache — debe coincidir con APP_VERSION en index.html ──
const CACHE_NAME = 'prospectopro-v1.0.11';

// Archivos que sí queremos cachear para funcionamiento offline
const ASSETS = [
  './index.html',
  './manifest.json'
  // Nota: sw.js no se cachea a sí mismo — el navegador lo gestiona aparte
];

// ── INSTALL: cachea los assets estáticos incluyendo index.html ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .catch(err => console.warn('SW install cache error:', err))
  );
  self.skipWaiting();
});

// ── ACTIVATE: elimina caches viejos ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH: estrategia según tipo de recurso ──
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // index.html — siempre intentar red primero, caché como fallback
  if (url.endsWith('/') || url.includes('index.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          // Actualizar caché con la versión más reciente
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request)
          .then(cached => cached || new Response('<h1>Sin conexión</h1><p>Conéctate para usar ProspectoPRO.</p>', {
            headers: { 'Content-Type': 'text/html' }
          }))
        )
    );
    return;
  }

  // Firebase SDK y Google Fonts — solo red, sin cachear
  if (url.includes('gstatic.com') || url.includes('googleapis.com') ||
      url.includes('firebaseapp.com') || url.includes('firestore.googleapis.com')) {
    e.respondWith(
      fetch(e.request).catch(() => new Response('', { status: 503 }))
    );
    return;
  }

  // Resto de assets — caché primero, red como fallback
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request)
        .then(res => {
          if (!res || res.status !== 200 || res.type === 'opaque') return res;
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return res;
        })
        .catch(() => new Response('', { status: 503 }));
    })
  );
});

// ── PUSH NOTIFICATIONS desde servidor ──
self.addEventListener('push', e => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    console.warn('SW push: payload no es JSON válido', err);
    data = { title: 'ProspectoPRO', body: e.data ? e.data.text() : '' };
  }

  const title = data.title || 'ProspectoPRO';
  const options = {
    body: data.body || '',
    icon: data.icon || './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || 'prospectopro',
    requireInteraction: true,
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Al tocar la notificación, enfocar o abrir la app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (let c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow('./');
    })
  );
});

// ── Mensajes desde la app principal ──
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_CHECK') {
    checkScheduledNotifs(e.data.prospects, e.data.agenda);
  }
});

// ── Notificaciones programadas desde el SW ──
function checkScheduledNotifs(prospects, agenda) {
  if (!prospects || !agenda) return;

  const now = new Date();
  // Fecha local en formato YYYY-MM-DD
  const today = now.getFullYear() + '-' +
    String(now.getMonth() + 1).padStart(2, '0') + '-' +
    String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');

  // Prospectos con seguimiento vencido — notificar una vez por hora, en punto
  if (mm === '00') {
    const pendientes = prospects.filter(p =>
      p.proximoSeguimiento <= today &&
      !['cerrado', 'perdido'].includes(p.etapaVenta)
    );
    if (pendientes.length > 0) {
      const nombres = pendientes.slice(0, 3).map(p => p.nombre).join(', ') +
        (pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : '');
      self.registration.showNotification(
        `📞 ${pendientes.length} seguimiento${pendientes.length > 1 ? 's' : ''} pendiente${pendientes.length > 1 ? 's' : ''}`,
        {
          body: nombres,
          icon: './icon-192.png',
          badge: './icon-192.png',
          tag: `seguimientos-${today}-${hh}`,   // tag incluye hora para no duplicar
          requireInteraction: true
        }
      );
    }
  }

  // Citas de agenda — avisar 30 min antes y al momento exacto
  agenda.forEach(cita => {
    if (cita.fecha !== today || !cita.hora) return;

    const [ch, cm] = cita.hora.split(':').map(Number);
    const citaDate = new Date(now);
    citaDate.setHours(ch, cm, 0, 0);
    const diff = Math.round((citaDate - now) / 60000); // minutos restantes

    if (diff === 30) {
      self.registration.showNotification('🔔 Cita en 30 minutos', {
        body: `${cita.hora} · ${cita.titulo || cita.prospectName || 'Cita agendada'}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `cita-30-${cita.id || cita.hora}`,
        requireInteraction: true
      });
    }

    // diff === 0 (y solo 0, -0 === 0 en JS)
    if (diff === 0) {
      self.registration.showNotification('⏰ ¡Es la hora! Cita pendiente', {
        body: `${cita.hora} · ${cita.titulo || cita.prospectName || 'Cita agendada'}`,
        icon: './icon-192.png',
        badge: './icon-192.png',
        tag: `cita-now-${cita.id || cita.hora}`,
        requireInteraction: true
      });
    }
  });
}
