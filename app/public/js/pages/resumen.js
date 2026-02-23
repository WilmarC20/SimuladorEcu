import { api, $ } from '../api.js';

export async function loadResumen() {
  try {
    const data = await api('/host/network');
    const grid = $('resumen-pi');
    const w = data.wifi ? `${data.wifi.name} (${data.wifi.mac})` : 'no';
    const b = data.bt ? `${data.bt.name} (${data.bt.mac})` : 'no';
    grid.innerHTML = `<div class="kv"><span class="k">WiFi</span><div class="v">${w}</div></div><div class="kv"><span class="k">Bluetooth</span><div class="v">${b}</div></div>`;
  } catch (e) {
    $('resumen-pi').innerHTML = '<div class="kv"><span class="v">Error al cargar</span></div>';
  }
  try {
    const gps = await api('/gps-serial/status');
    $('resumen-gps-status').textContent = gps.open ? `Abierto ${gps.path} @ ${gps.baudRate}` : 'Cerrado';
  } catch (_) {
    $('resumen-gps-status').textContent = '—';
  }
}
