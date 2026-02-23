import { api, $, postWithTimeout } from '../api.js';
import { initGpsMapIfNeeded, updateGpsMapPosition, setGpsMapRoute } from '../gps-map.js';

const DASHBOARD_ERROR_MSG = 'No se pudo conectar al emulador OBD2. Comprueba que el servidor esté en marcha.';
const DASHBOARD_TIMEOUT_MS = 5000;
const API_TIMEOUT_MS = 8000;

function q(id) {
  const el = $(id);
  return el ? el.value : '';
}

function updateBtServerStatus(d) {
  const el = $('obd2-bt-server-status');
  if (!el) return;
  if (d.btStarted) {
    el.innerHTML = '<span class="status-dot ok"></span> Servidor OBD Bluetooth: <strong>activo</strong>' +
      (d.btConnected ? ' (Torque conectado)' : '');
  } else if (d.btServerError) {
    el.innerHTML = '<span class="status-dot off"></span> Servidor OBD Bluetooth: <strong>error</strong> — ' + escapeHtml(d.btServerError);
  } else if (d.btAvailable === false) {
    el.innerHTML = '<span class="status-dot off"></span> Servidor OBD Bluetooth: <strong>no disponible</strong>';
  } else {
    el.innerHTML = '<span class="status-dot off"></span> Servidor OBD Bluetooth: no activo';
  }
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

const TYPE_LABELS = { can: 'Puerto OBD (CAN)', bt: 'Bluetooth', tcp: 'WiFi (TCP)' };

function formatConnTime(ms) {
  if (ms == null) return '—';
  const d = new Date(ms);
  const now = Date.now();
  const sec = Math.floor((now - ms) / 1000);
  if (sec < 60) return 'hace ' + sec + ' s';
  if (sec < 3600) return 'hace ' + Math.floor(sec / 60) + ' min';
  return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function loadConnections() {
  try {
    const data = await api('/connections', { timeout: 4000 });
    const list = data.connections || [];
    const tbody = $('connections-tbody');
    const select = $('conn-log-filter');
    const countEl = $('connections-count');
    if (!tbody) return;
    if (countEl) countEl.textContent = list.length + (list.length === 1 ? ' dispositivo' : ' dispositivos');
    const options = [{ id: '', label: 'Todos los dispositivos' }];
    list.forEach(c => options.push({ id: c.id, label: (TYPE_LABELS[c.type] || c.type) + ' — ' + (c.macOrIp || c.address || c.id) }));
    if (select) {
      const cur = select.value;
      select.innerHTML = '';
      options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = o.label;
        select.appendChild(opt);
      });
      if (options.some(o => o.id === cur)) select.value = cur;
    }
    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="connections-empty">Ningún dispositivo conectado</td></tr>';
      return;
    }
    tbody.innerHTML = list.map(c => {
      const typeLabel = TYPE_LABELS[c.type] || c.type;
      const typeClass = 'conn-type conn-type--' + (c.type === 'can' ? 'can' : c.type === 'bt' ? 'bt' : 'tcp');
      const mac = escapeHtml(c.macOrIp || c.address || '—');
      const time = formatConnTime(c.lastActivity);
      return '<tr><td><span class="' + typeClass + '">' + escapeHtml(typeLabel) + '</span></td><td>' + mac + '</td><td>' + time + '</td></tr>';
    }).join('');
  } catch (e) {
    const tbody = $('connections-tbody');
    if (tbody) {
      const msg = e && e.message ? e.message : 'Error al cargar';
      const hint = msg.indexOf('404') >= 0 ? ' Reinicia el servidor del dashboard.' : '';
      tbody.innerHTML = '<tr><td colspan="3" class="connections-empty">' + escapeHtml(msg) + hint + '</td></tr>';
    }
  }
}

async function loadConnectionLog() {
  try {
    const filterEl = $('conn-log-filter');
    const connectionId = filterEl && filterEl.value ? filterEl.value.trim() : '';
    const url = '/connection-log?limit=150' + (connectionId ? '&connectionId=' + encodeURIComponent(connectionId) : '');
    const data = await api(url, { timeout: 4000 });
    const log = data.log || [];
    const pre = $('connection-log');
    if (!pre) return;
    if (log.length === 0) {
      pre.textContent = 'Esperando tráfico…';
      return;
    }
    const lines = log.map(e => {
      const ts = new Date(e.ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String((e.ts % 1000) + 1000).slice(1);
      const conn = e.connectionId || '—';
      const req = String(e.request || '').slice(0, 80);
      const res = String(e.response || '').replace(/\r/g, '\\r').slice(0, 120);
      return '[' + ts + '] [' + conn + '] ' + req + ' → ' + res;
    });
    pre.textContent = lines.join('\n');
    pre.scrollTop = pre.scrollHeight;
  } catch (e) {
    const pre = $('connection-log');
    if (pre) {
      const msg = e && e.message ? e.message : 'Error al cargar el log.';
      pre.textContent = msg + (msg.indexOf('404') >= 0 ? ' Reinicia el servidor del dashboard.' : '');
    }
  }
}

function updateGaugeClass(gaugeEl, value, pid) {
  if (!gaugeEl || value == null || value === '--') {
    gaugeEl.classList.remove('gauge--warn', 'gauge--danger');
    return;
  }
  const num = typeof value === 'number' ? value : parseInt(value, 10);
  if (isNaN(num)) { gaugeEl.classList.remove('gauge--warn', 'gauge--danger'); return; }
  gaugeEl.classList.remove('gauge--warn', 'gauge--danger');
  if (pid === 'coolant' && num >= 100) gaugeEl.classList.add('gauge--danger');
  else if (pid === 'coolant' && num >= 90) gaugeEl.classList.add('gauge--warn');
  else if (pid === 'rpm' && num >= 6000) gaugeEl.classList.add('gauge--danger');
  else if (pid === 'rpm' && num >= 5000) gaugeEl.classList.add('gauge--warn');
  else if (pid === 'fuel' && num <= 10) gaugeEl.classList.add('gauge--danger');
  else if (pid === 'fuel' && num <= 20) gaugeEl.classList.add('gauge--warn');
}

export async function pollObd2() {
  try {
    const d = await api('/dashboard', { timeout: DASHBOARD_TIMEOUT_MS });
    $('obd2-status').innerHTML = '<span class="status-dot ok"></span> Conectado al emulador OBD2';
    updateBtServerStatus(d);
    const gauges = [
      ['g-speed', d.speed, 'speed'],
      ['g-rpm', d.rpm, 'rpm'],
      ['g-coolant', d.coolantTemp, 'coolant'],
      ['g-load', d.engineLoad, 'load'],
      ['g-intake', d.intakeTemp, 'intake'],
      ['g-fuel', d.fuelLevel, 'fuel'],
    ];
    const dash = $('dashboard-gauges');
    const arcLen = 172.8;
    gauges.forEach(([id, val, pid]) => {
      const el = $(id);
      const container = el && el.closest('.gauge');
      if (el) el.textContent = val != null ? val : '--';
      if (container) updateGaugeClass(container, val, pid);
      const num = val != null && val !== '--' ? (typeof val === 'number' ? val : parseInt(val, 10)) : null;
      if (dash && !isNaN(num)) {
        if (id === 'g-speed') {
          const pct = Math.min(100, (num / 240) * 100);
          dash.style.setProperty('--speed-offset', String(arcLen * (1 - pct / 100)));
        } else if (id === 'g-rpm') {
          const pct = Math.min(100, (num / 8000) * 100);
          dash.style.setProperty('--rpm-offset', String(arcLen * (1 - pct / 100)));
        }
      }
    });
    if (dash) {
      ['coolant', 'load', 'intake', 'fuel'].forEach(pid => {
        const fillEl = $(pid + '-fill');
        if (!fillEl) return;
        const map = { coolant: d.coolantTemp, load: d.engineLoad, intake: d.intakeTemp, fuel: d.fuelLevel };
        const v = map[pid];
        const max = pid === 'coolant' ? 130 : pid === 'intake' ? 80 : 100;
        const pct = v != null && !isNaN(Number(v)) ? Math.min(100, (Number(v) / max) * 100) : 0;
        fillEl.style.width = pct + '%';
      });
    }
    if (d.sim) {
      const statusText = $('sim-status-text');
      if (statusText) {
        statusText.textContent = d.sim.enabled ? `Simulación: ${d.sim.profile || 'idle'}` : '';
      }
      const profileRadio = document.querySelector(`input[name="sim-profile"][value="${d.sim.profile || 'idle'}"]`);
      if (profileRadio) profileRadio.checked = true;
      if (d.sim.errorSim) {
        (document.querySelectorAll('.fail-pid') || []).forEach(cb => {
          cb.checked = (d.sim.errorSim.failPids || []).indexOf(cb.value) >= 0;
        });
        const noiseEl = $('noise-percent');
        const noiseVal = $('noise-value');
        if (noiseEl) noiseEl.value = d.sim.errorSim.noisePercent || 0;
        if (noiseVal) noiseVal.textContent = (d.sim.errorSim.noisePercent || 0) + '%';
      }
    }
    if (d.ecuProfile) {
      const nameEl = $('ecu-profile-name');
      if (nameEl) nameEl.textContent = d.ecuProfile.vehicleName || '—';
    }
    $('resumen-obd').innerHTML = '<span class="status-dot ok"></span> Emulador OBD2 conectado';
    loadEcuProfiles();
    loadConnections();
    loadConnectionLog();
  } catch (e) {
    $('obd2-status').innerHTML =
      '<span class="status-dot off"></span> No conectado al emulador';
    const el = $('obd2-bt-server-status');
    if (el) el.innerHTML = '<span class="status-dot off"></span> Servidor OBD Bluetooth: no se pudo comprobar';
    ['g-speed', 'g-rpm', 'g-coolant', 'g-load', 'g-intake', 'g-fuel'].forEach(id => {
      const el = $(id);
      if (el) el.textContent = '--';
      const container = el && el.closest('.gauge');
      if (container) container.classList.remove('gauge--warn', 'gauge--danger');
    });
    const dash = $('dashboard-gauges');
    if (dash) {
      dash.style.removeProperty('--speed-offset');
      dash.style.removeProperty('--rpm-offset');
      ['coolant-fill', 'load-fill', 'intake-fill', 'fuel-fill'].forEach(fid => {
        const f = $(fid);
        if (f) f.style.width = '0%';
      });
    }
    const st = $('sim-status-text');
    if (st) st.textContent = '';
    $('resumen-obd').innerHTML = '<span class="status-dot off"></span> Sin conexión al emulador OBD2';
  }
}

async function loadEcuProfiles() {
  const select = $('ecu-profile-select');
  if (!select) return;
  try {
    const d = await api('/ecu-profiles', { timeout: 5000 });
    const list = (d && d.list) || [];
    const active = (d && d.active) || '';
    select.innerHTML = '<option value="">Default (genérico)</option>';
    list.forEach((p) => {
      if (p.error) return;
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.vehicleName || p.name;
      if (p.name === active) opt.selected = true;
      select.appendChild(opt);
    });
    if (active && !select.value) select.value = active;
  } catch (_) {
    select.innerHTML = '<option value="">Default (genérico)</option>';
  }
}

async function loadDtc() {
  try {
    const d = await api('/dtc', { timeout: 5000 });
    const el = $('dtc-dump');
    if (el) el.textContent = JSON.stringify(d, null, 2);
  } catch (e) {
    const el = $('dtc-dump');
    if (el) el.textContent = '[]';
  }
}

let gpsSentPollId = null;

async function loadGpsSavedRoutesSelect() {
  const sel = $('gps-saved-route');
  if (!sel) return;
  try {
    const list = await api('/saved-routes', { timeout: 3000 });
    const current = sel.value;
    sel.innerHTML = '<option value="">— Cargar ruta guardada —</option>' +
      (list || []).map(r => `<option value="${(r.id || '').replace(/"/g, '&quot;')}">${escapeHtml(r.name || 'Sin nombre')}</option>`).join('');
    if (current) sel.value = current;
  } catch (_) {
    sel.innerHTML = '<option value="">— Cargar ruta guardada —</option>';
  }
}

function renderGpsLastSent(st) {
  const pre = $('gps-last-sent');
  const statusEl = $('gps-t38-serial-status');
  const hintEl = $('gps-last-sent-hint');
  if (st == null) st = {};
  const open = st.open ?? st.serialOpen ?? false;
  const path = st.path ?? st.serialPath ?? '';
  const baud = st.baudRate ?? st.serialBaudRate ?? '';
  const lines = Array.isArray(st.lastSentLines) ? st.lastSentLines : [];
  if (statusEl) {
    statusEl.textContent = open
      ? `Puerto serial: abierto ${path || ''} @ ${baud || ''} — listo para enviar.`
      : 'Puerto serial: cerrado. Ábrelo en la pestaña "Emulador GPS NEO" (ej. /dev/ttyS0) y pulsa Abrir puerto.';
    statusEl.style.color = open ? 'var(--accent)' : 'var(--warn)';
  }
  if (lines.length > 0) {
    if (pre) pre.textContent = lines.join('\n');
    if (hintEl) hintEl.style.display = 'none';
  } else {
    if (pre) pre.textContent = '—';
    if (hintEl) hintEl.style.display = 'block';
    if (hintEl && open) hintEl.textContent = 'Enviando… Las tramas aparecerán aquí en unos segundos.';
    else if (hintEl && !open) hintEl.innerHTML = 'Abre el puerto en <strong>Emulador GPS NEO</strong> y pulsa <strong>Iniciar envío por serial</strong> para ver las tramas aquí.';
  }
}

async function updateGpsLastSent() {
  try {
    const st = await api('/gps-serial/status', { timeout: 3000 });
    renderGpsLastSent(st);
    const s = await api('/gps/status', { timeout: 3000 });
    const lat = typeof s.currentLat === 'number' ? s.currentLat : parseFloat(s.currentLat ?? s.lat);
    const lon = typeof s.currentLon === 'number' ? s.currentLon : parseFloat(s.currentLon ?? s.lon);
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) updateGpsMapPosition(lat, lon);
  } catch (_) {
    try {
      const s = await api('/gps/status', { timeout: 3000 });
      renderGpsLastSent(s);
      const lat = typeof s.currentLat === 'number' ? s.currentLat : parseFloat(s.currentLat ?? s.lat);
      const lon = typeof s.currentLon === 'number' ? s.currentLon : parseFloat(s.currentLon ?? s.lon);
      if (!Number.isNaN(lat) && !Number.isNaN(lon)) updateGpsMapPosition(lat, lon);
    } catch (e2) {
      renderGpsLastSent({ open: false, lastSentLines: [] });
    }
  }
}

async function loadGpsT38() {
  try {
    const s = await api('/gps/status', { timeout: 5000 });
    const el = $('gps-t38-state');
    const forDisplay = { ...s };
    if (forDisplay.lastSentLines) delete forDisplay.lastSentLines;
    if (el) el.textContent = JSON.stringify(forDisplay, null, 2);
    const waypointsEl = $('gps-waypoints');
    if (waypointsEl && s.routeWaypoints && Array.isArray(s.routeWaypoints) && s.routeWaypoints.length > 0) {
      waypointsEl.value = JSON.stringify(s.routeWaypoints, null, 2);
    }
    const speedMinEl = $('gps-speed-min');
    const speedMaxEl = $('gps-speed-max');
    if (speedMinEl && typeof s.speedMinKmh === 'number') speedMinEl.value = String(s.speedMinKmh);
    if (speedMaxEl && typeof s.speedMaxKmh === 'number') speedMaxEl.value = String(s.speedMaxKmh);
    await loadGpsSavedRoutesSelect();
    renderGpsLastSent(s);
    const lat = typeof s.currentLat === 'number' ? s.currentLat : (typeof s.lat === 'number' ? s.lat : parseFloat(s.currentLat ?? s.lat));
    const lon = typeof s.currentLon === 'number' ? s.currentLon : (typeof s.lon === 'number' ? s.lon : parseFloat(s.currentLon ?? s.lon));
    if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
      initGpsMapIfNeeded(lat, lon).catch(() => {});
      updateGpsMapPosition(lat, lon);
    }
    setGpsMapRoute(s.routeWaypoints && Array.isArray(s.routeWaypoints) && s.routeWaypoints.length >= 2 ? s.routeWaypoints : null);
    if (s.enabled && !gpsSentPollId) {
      gpsSentPollId = setInterval(updateGpsLastSent, 1000);
    } else if (!s.enabled && gpsSentPollId) {
      clearInterval(gpsSentPollId);
      gpsSentPollId = null;
    }
  } catch (e) {
    const el = $('gps-t38-state');
    if (el) el.textContent = '{}';
    renderGpsLastSent({ open: false, lastSentLines: [] });
  }
}

export { loadGpsT38 };

export function bindObd2() {
  $('obd-send').onclick = async () => {
    const cmd = $('obd-cmd').value.trim();
    if (!cmd) return;
    try {
      const r = await fetch('/api/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'c=' + encodeURIComponent(cmd),
      });
      const data = await r.json();
      $('obd-response').textContent = data.raw != null ? data.raw : JSON.stringify(data);
    } catch (e) {
      $('obd-response').textContent = 'Error: ' + e.message + ' (¿emulador OBD2 conectado?)';
    }
  };

  const valApply = $('val-apply');
  if (valApply) {
    valApply.onclick = async () => {
      try {
        const r = await postWithTimeout('/set_values', new URLSearchParams({
          speed: q('val-speed'),
          rpm: q('val-rpm'),
          coolantTemp: q('val-ct'),
          engineLoad: q('val-load'),
          intakeTemp: q('val-it'),
          fuelLevel: q('val-fuel'),
        }), API_TIMEOUT_MS);
        if (r.ok) pollObd2();
      } catch (e) {
        alert(DASHBOARD_ERROR_MSG);
      }
    };
  }

  const dtcOn = $('dtc-on');
  if (dtcOn) dtcOn.onclick = async () => {
    try {
      await postWithTimeout('/set_dtc', new URLSearchParams({ code: q('dtc-code'), mode: q('dtc-mode'), on: '1' }), API_TIMEOUT_MS);
      loadDtc();
    } catch (e) { if ($('dtc-dump')) $('dtc-dump').textContent = '[]'; }
  };
  const dtcOff = $('dtc-off');
  if (dtcOff) dtcOff.onclick = async () => {
    try {
      await postWithTimeout('/set_dtc', new URLSearchParams({ code: q('dtc-code'), mode: q('dtc-mode'), on: '0' }), API_TIMEOUT_MS);
      loadDtc();
    } catch (e) { if ($('dtc-dump')) $('dtc-dump').textContent = '[]'; }
  };
  const dtcClear = $('dtc-clear');
  if (dtcClear) dtcClear.onclick = async () => {
    try {
      await postWithTimeout('/clear_dtcs', null, API_TIMEOUT_MS);
      loadDtc();
    } catch (e) { if ($('dtc-dump')) $('dtc-dump').textContent = '[]'; }
  };

  const simStart = $('sim-start');
  if (simStart) simStart.onclick = async () => {
    const profileEl = document.querySelector('input[name="sim-profile"]:checked');
    const profile = (profileEl && profileEl.value) || 'idle';
    try {
      const r = await postWithTimeout('/simulation/start', new URLSearchParams({ profile }), API_TIMEOUT_MS);
      if (r.ok) pollObd2();
      else alert(DASHBOARD_ERROR_MSG);
    } catch (e) {
      alert(DASHBOARD_ERROR_MSG);
    }
  };
  const simStop = $('sim-stop');
  if (simStop) simStop.onclick = async () => {
    try {
      const r = await postWithTimeout('/simulation/stop', null, API_TIMEOUT_MS);
      if (r.ok) pollObd2();
    } catch (e) {
      alert(DASHBOARD_ERROR_MSG);
    }
  };

  const noiseSlider = $('noise-percent');
  const noiseValueEl = $('noise-value');
  if (noiseSlider && noiseValueEl) {
    noiseSlider.oninput = () => { noiseValueEl.textContent = noiseSlider.value + '%'; };
  }

  const connLogFilter = $('conn-log-filter');
  if (connLogFilter) connLogFilter.addEventListener('change', () => loadConnectionLog());

  const errorSimApply = $('error-sim-apply');
  if (errorSimApply) errorSimApply.onclick = async () => {
    const failPids = [];
    (document.querySelectorAll('.fail-pid:checked') || []).forEach(cb => failPids.push(cb.value));
    const noisePercent = parseInt(noiseSlider?.value || '0', 10) || 0;
    try {
      const r = await fetch('/api/simulation/errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failPids, noisePercent }),
      });
      const data = await r.json();
      if (data.ok) pollObd2();
    } catch (e) {
      alert(DASHBOARD_ERROR_MSG);
    }
  };

  const ecuProfileLoad = $('ecu-profile-load');
  const ecuProfileSelect = $('ecu-profile-select');
  const ecuProfileShow = $('ecu-profile-show');
  const ecuProfileDetail = $('ecu-profile-detail');
  const ecuProfileDetailName = $('ecu-profile-detail-name');
  const ecuProfileDetailProtocol = $('ecu-profile-detail-protocol');
  const ecuProfileDetailPids = $('ecu-profile-detail-pids');

  if (ecuProfileLoad && ecuProfileSelect) {
    ecuProfileLoad.onclick = async () => {
      const name = (ecuProfileSelect.value || '').trim();
      try {
        const r = await fetch('/api/ecu-profiles/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name || '' }),
        });
        const data = await r.json();
        if (data.ok) {
          pollObd2();
          loadEcuProfiles();
        } else {
          alert(data.error || 'Error al cargar perfil');
        }
      } catch (e) {
        alert(DASHBOARD_ERROR_MSG);
      }
    };
  }

  if (ecuProfileShow && ecuProfileSelect) {
    ecuProfileShow.onclick = async () => {
      const name = (ecuProfileSelect.value || '').trim();
      const nameForUrl = name ? '/' + encodeURIComponent(name) : '';
      try {
        const profile = await api('/ecu-profiles/detail' + nameForUrl, { timeout: 5000 });
        if (!ecuProfileDetail) return;
        ecuProfileDetail.hidden = false;
        if (ecuProfileDetailName) ecuProfileDetailName.textContent = 'Vehículo: ' + (profile.vehicleName || '—');
        if (ecuProfileDetailProtocol) ecuProfileDetailProtocol.textContent = 'Protocolo: ' + (profile.protocol || '—');
        if (ecuProfileDetailPids) {
          const pids = profile.pids || [];
          if (pids.length === 0) {
            ecuProfileDetailPids.innerHTML = '<p class="kv">Sin PIDs definidos.</p>';
          } else {
            const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
          ecuProfileDetailPids.innerHTML = '<table class="ecu-pids-table"><thead><tr><th>PID</th><th>Nombre</th><th>Bytes</th><th>Codificación</th></tr></thead><tbody>' +
              pids.map((p) => '<tr><td>01 ' + esc(p.id) + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.bytes) + '</td><td><code>' + esc(p.encode != null ? p.encode : '—') + '</code></td></tr>').join('') +
              '</tbody></table>';
          }
        }
      } catch (e) {
        if (ecuProfileDetail) ecuProfileDetail.hidden = false;
        if (ecuProfileDetailName) ecuProfileDetailName.textContent = 'Error al cargar el perfil.';
        if (ecuProfileDetailProtocol) ecuProfileDetailProtocol.textContent = '';
        if (ecuProfileDetailPids) ecuProfileDetailPids.innerHTML = '';
      }
    };
  }

  const gpsLoadSavedRoute = $('gps-load-saved-route');
  if (gpsLoadSavedRoute) gpsLoadSavedRoute.onclick = async () => {
    const sel = $('gps-saved-route');
    const id = sel && sel.value ? sel.value.trim() : '';
    if (!id) return alert('Elige una ruta guardada');
    try {
      const route = await api('/saved-routes/' + encodeURIComponent(id), { timeout: 3000 });
      const waypoints = route.waypoints || [];
      if (waypoints.length < 2) return alert('La ruta no tiene suficientes puntos');
      const first = waypoints[0];
      const params = new URLSearchParams({
        lat: first.lat,
        lon: first.lon,
        routeOn: '1',
        routeWaypoints: JSON.stringify(waypoints),
      });
      const r = await postWithTimeout('/gps/config', params, API_TIMEOUT_MS);
      if (r && r.ok) {
        const wpEl = $('gps-waypoints');
        if (wpEl) wpEl.value = JSON.stringify(waypoints, null, 2);
        loadGpsT38();
      }
    } catch (e) {
      alert('Error al cargar la ruta: ' + (e.message || ''));
    }
  };

  const gpsT38Apply = $('gps-t38-apply');
  if (gpsT38Apply) gpsT38Apply.onclick = async () => {
    try {
      const params = {
        lat: q('gps-lat'),
        lon: q('gps-lon'),
        alt: q('gps-alt'),
        sats: q('gps-sats'),
        satsMin: q('gps-sats-min'),
        satsMax: q('gps-sats-max'),
        course: q('gps-course'),
        baud: q('gps-baud-t38'),
        routeOn: q('gps-route-on') || '1',
        routeRadius: q('gps-radius'),
        speedMinKmh: q('gps-speed-min') || '20',
        speedMaxKmh: q('gps-speed-max') || '50',
        speedKmh: (parseFloat(q('gps-speed-min')) + parseFloat(q('gps-speed-max'))) / 2 || 35,
        intervalMs: q('gps-interval') || '1000',
        noFix: ($('gps-no-fix') && $('gps-no-fix').checked) ? '1' : '0',
        badHdop: ($('gps-bad-hdop') && $('gps-bad-hdop').checked) ? '1' : '0',
        jitterMeters: q('gps-jitter') || '0',
        dropPercent: q('gps-drop') || '0',
      };
      const wp = $('gps-waypoints') && $('gps-waypoints').value.trim();
      if (wp) params.routeWaypoints = wp;
      const r = await postWithTimeout('/gps/config', new URLSearchParams(params), API_TIMEOUT_MS);
      if (r.ok) { loadGpsT38(); pollObd2(); }
    } catch (e) { alert(DASHBOARD_ERROR_MSG); }
  };
  const gpsT38Start = $('gps-t38-start');
  if (gpsT38Start) gpsT38Start.onclick = async () => {
    try {
      const r = await postWithTimeout('/gps/start', null, API_TIMEOUT_MS);
      if (r && r.ok) {
        loadGpsT38();
        pollObd2();
        setTimeout(updateGpsLastSent, 400);
        setTimeout(updateGpsLastSent, 1200);
      } else if (r && r.msg) {
        alert(r.msg);
      } else {
        alert(DASHBOARD_ERROR_MSG);
      }
    } catch (e) { alert(DASHBOARD_ERROR_MSG); }
  };
  const gpsT38Stop = $('gps-t38-stop');
  if (gpsT38Stop) gpsT38Stop.onclick = async () => {
    try {
      const r = await postWithTimeout('/gps/stop', null, API_TIMEOUT_MS);
      if (r.ok) { loadGpsT38(); pollObd2(); }
    } catch (e) { alert(DASHBOARD_ERROR_MSG); }
  };
}
