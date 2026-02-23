import { api, $ } from '../api.js';
import { loadResumen } from './resumen.js';

export async function loadGpsPorts() {
  try {
    const data = await api('/gps-serial/ports');
    const sel = $('gps-port');
    sel.innerHTML =
      '<option value="">— Selecciona —</option>' +
      (data.ports || []).map(
        p => `<option value="${p.path}">${p.path} ${p.manufacturer ? '(' + p.manufacturer + ')' : ''}</option>`
      ).join('');
  } catch (_) {}
  try {
    const st = await api('/gps-serial/status');
    $('gps-open-status').textContent = st.open ? `Abierto: ${st.path} @ ${st.baudRate}` : '';
  } catch (_) {}
}

export function bindGps() {
  $('gps-open').onclick = async () => {
    const path = $('gps-port').value;
    const baudRate = $('gps-baud').value;
    if (!path) return alert('Selecciona un puerto');
    try {
      const r = await fetch('/api/gps-serial/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, baudRate: Number(baudRate) }),
      });
      const data = r.ok ? await r.json().catch(() => ({})) : await r.json().catch(() => ({ msg: 'Error al abrir' }));
      if (r.ok) {
        $('gps-open-status').textContent = `Abierto: ${path} @ ${baudRate}`;
        loadResumen();
      } else if (r.status === 409) {
        try {
          const st = await api('/gps-serial/status');
          $('gps-open-status').textContent = st.open ? `Abierto: ${st.path} @ ${st.baudRate}` : 'Puerto ya abierto';
        } catch (_) {
          $('gps-open-status').textContent = 'Puerto ya abierto';
        }
        loadResumen();
      } else {
        alert(data.msg || 'No se pudo abrir el puerto');
      }
    } catch (e) {
      alert('Error: ' + (e.message || 'no se pudo abrir'));
    }
  };

  $('gps-close').onclick = async () => {
    try {
      await fetch('/api/gps-serial/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      $('gps-open-status').textContent = '';
      loadResumen();
      loadGpsPorts();
    } catch (_) {}
  };

  $('gps-send').onclick = async () => {
    const line = $('gps-nmea').value.trim();
    if (!line) return alert('Escribe una línea NMEA');
    try {
      const r = await fetch('/api/gps-serial/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line }),
      });
      const data = await r.json();
      if (data.ok) $('gps-open-status').textContent = 'Enviado ' + (data.lastSent || '');
      else alert(data.msg || 'Error');
    } catch (e) {
      alert('Error o puerto cerrado');
    }
  };
}
