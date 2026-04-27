const CACHE_NAME = 'prospectopro-v1.0.8';
const ASSETS = ['./sw.js', './manifest.json'];

// ── INSTALL: cache only static assets, NOT index.html ──
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

// ── ACTIVATE: clean old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── FETCH: index.html siempre de red, resto de caché ──
self.addEventListener('fetch', e => {
  if(e.request.url.endsWith('/') || e.request.url.includes('index.html')){
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => cached))
  );
});

// ── PUSH NOTIFICATIONS desde el SW ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'ProspectoPRO';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'prospectopro',
    requireInteraction: true,
    data: { url: data.url || '/' }
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// ── Al tocar la notificación, abrir la app ──
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (let c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow('./');
    })
  );
});

// ── Mensajes desde la app principal ──
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SCHEDULE_CHECK') {
    checkScheduledNotifs(e.data.prospects, e.data.agenda);
  }
});

function checkScheduledNotifs(prospects, agenda) {
  if (!prospects || !agenda) return;
  const now = new Date();
  // Usar fecha local, no UTC
  const today = now.getFullYear() + '-' +
    (now.getMonth()+1).toString().padStart(2,'0') + '-' +
    now.getDate().toString().padStart(2,'0');
  const mm = now.getMinutes().toString().padStart(2,'0');

  // Prospectos con seguimiento vencido — avisar en punto de cada hora
  const pendientes = prospects.filter(p =>
    p.proximoSeguimiento <= today && !['cerrado', 'perdido'].includes(p.etapaVenta)
  );
  if (pendientes.length > 0 && mm === '00') {
    self.registration.showNotification(
      `📞 ${pendientes.length} seguimiento${pendientes.length > 1 ? 's' : ''} pendiente${pendientes.length > 1 ? 's' : ''}`,
      {
        body: pendientes.slice(0, 3).map(p => p.nombre).join(', ') +
          (pendientes.length > 3 ? ` y ${pendientes.length - 3} más` : ''),
        tag: 'seguimientos-' + today,
        requireInteraction: true
      }
    );
  }

  // Citas de agenda — avisar 30 min antes y en punto
  agenda.forEach(cita => {
    if (cita.fecha !== today || !cita.hora) return;
    const [ch, cm] = cita.hora.split(':').map(Number);
    const citaDate = new Date(now);
    citaDate.setHours(ch, cm, 0, 0);
    const diff = Math.round((citaDate - now) / 60000);

    if (diff === 30) {
      self.registration.showNotification('🔔 Cita en 30 minutos', {
        body: `${cita.hora} · ${cita.titulo || cita.prospectName || 'Cita agendada'}`,
        tag: 'cita-30-' + (cita.id || cita.hora),
        requireInteraction: true
      });
    }
    if (diff <= 1 && diff >= 0) {
      self.registration.showNotification('⏰ ¡Es la hora! Cita pendiente', {
        body: `${cita.hora} · ${cita.titulo || cita.prospectName || 'Cita agendada'}`,
        tag: 'cita-now-' + (cita.id || cita.hora),
        requireInteraction: true
      });
    }
  });
}
