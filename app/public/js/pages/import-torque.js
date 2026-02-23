/**
 * Importar Torque Pro: solo CSV útiles, vista previa con sensores, duración y km de ruta.
 */
import { $ } from '../api.js';

const CSV_EXT = /\.csv$/i;
const TIME_HEADERS = /^(time|timestamp|device time|gps time|date|t|elapsed|utc|recorded time|recording time|log time|datetime|time \(ms\)|time \(s\)|time \(utc\))/i;
const TIME_HEADERS_FALLBACK = /(?:^|\s)(time|date|timestamp)(?:\s|$)/i;
const LAT_HEADERS = /^(gps latitude|latitude|lat|gps_latitude)$/i;
const LON_HEADERS = /^(gps longitude|longitude|lon|lng|gps_longitude)$/i;
const SPEED_HEADERS = /^(gps speed|speed|velocity|vel|gps speed \(km\/h\)|speed \(km\/h\))$/i;

function getTimeColumnIndex(headers) {
  let idx = headers.findIndex(h => TIME_HEADERS.test((h || '').trim()));
  if (idx >= 0) return idx;
  return headers.findIndex(h => TIME_HEADERS_FALLBACK.test((h || '').trim()));
}

let zipInstance = null;

function normalizeCSVContent(content) {
  if (!content || typeof content !== 'string') return '';
  return content.replace(/\uFEFF/g, '').trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function detectSeparator(line) {
  if (!line) return ',';
  const hasSemicolon = line.indexOf(';') >= 0;
  const commaCount = (line.match(/,/g) || []).length;
  const semicolonCount = (line.match(/;/g) || []).length;
  if (hasSemicolon && semicolonCount >= commaCount) return ';';
  return ',';
}

function parseCSVLine(line, sep) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === sep || c === '\t')) { cells.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
    else cur += c;
  }
  cells.push(cur.trim().replace(/^"|"$/g, ''));
  return cells;
}

/** Parsea CSV y devuelve { sensors, durationMin, routeKm } o null */
function parseCSVStats(content) {
  const raw = normalizeCSVContent(content);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 1) return null;
  const headerLine = lines[0];
  const sep = detectSeparator(headerLine);
  const headers = parseCSVLine(headerLine, sep).map(h => (h || '').trim());
  if (headers.length === 0 || headers.every(h => !h)) return null;
  const timeIdx = getTimeColumnIndex(headers);
  const latIdx = headers.findIndex(h => LAT_HEADERS.test((h || '').trim()));
  const lonIdx = headers.findIndex(h => LON_HEADERS.test((h || '').trim()));
  const hasTime = timeIdx >= 0;
  const hasLatLon = latIdx >= 0 && lonIdx >= 0;
  const numSensors = Math.max(0, headers.length - (hasTime ? 1 : 0) - (hasLatLon ? 2 : 0));

  let durationMin = null;
  let routeKm = null;
  let firstTime = null;
  let lastTime = null;
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i], sep);
    const row = {};
    headers.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
    rows.push(row);
  }
  if (rows.length === 0) return { sensors: numSensors, durationMin: 0, routeKm: null, durationText: '—', firstTime: null, lastTime: null };

  if (hasTime) {
    const timeKey = headers[timeIdx];
    const times = rows.map(r => parseTime(r[timeKey])).filter(t => t != null);
    if (times.length >= 1) {
      const min = Math.min(...times);
      const max = Math.max(...times);
      firstTime = min;
      lastTime = max;
      if (times.length >= 2) durationMin = (max - min) / 60000;
      else durationMin = 0;
    }
  }
  if (durationMin == null && rows.length > 0) durationMin = 0;
  if (hasLatLon) {
    const latKey = headers[latIdx];
    const lonKey = headers[lonIdx];
    let totalKm = 0;
    for (let i = 1; i < rows.length; i++) {
      const lat1 = parseFloat(rows[i - 1][latKey]);
      const lon1 = parseFloat(rows[i - 1][lonKey]);
      const lat2 = parseFloat(rows[i][latKey]);
      const lon2 = parseFloat(rows[i][lonKey]);
      if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) continue;
      totalKm += haversineKm(lat1, lon1, lat2, lon2);
    }
    routeKm = totalKm > 0 ? totalKm : null;
  }

  const durationText = formatDurationHMS(durationMin != null ? durationMin : (rows.length > 0 ? 0 : null));
  return { sensors: numSensors, durationMin: durationMin ?? 0, routeKm, durationText, firstTime, lastTime };
}

/** Formatea duración en minutos a HH:MM:SS (o 0:00:00 si null) */
function formatDurationHMS(durationMin) {
  if (durationMin == null || !Number.isFinite(durationMin)) return '—';
  const totalSec = Math.max(0, Math.round(durationMin * 60));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = n => (n < 10 ? '0' : '') + n;
  return h + ':' + pad(m) + ':' + pad(s);
}

/** Sanitiza un título para usarlo en nombre de archivo/carpeta */
function sanitizeTitleForPath(t) {
  if (t == null || typeof t !== 'string') return '';
  return t.trim().replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').slice(0, 150) || 'ruta';
}

/** Obtiene nombre de lugar por lat/lon (reverse geocoding). Devuelve cadena corta o null. */
async function getPlaceName(lat, lon, apiKey) {
  if (!apiKey || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const url = 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + lat + ',' + lon + '&key=' + encodeURIComponent(apiKey) + '&language=es';
    const res = await fetch(url);
    const data = await res.json();
    if (data.status !== 'OK' || !data.results || data.results.length === 0) return null;
    const comp = data.results[0].address_components || [];
    const locality = comp.find(c => c.types.includes('locality'));
    if (locality && locality.long_name) return locality.long_name;
    const admin2 = comp.find(c => c.types.includes('administrative_area_level_2'));
    if (admin2 && admin2.long_name) return admin2.long_name;
    const addr = (data.results[0].formatted_address || '').split(',')[0].trim();
    return addr || null;
  } catch (_) {
    return null;
  }
}

function parseTime(v) {
  if (v == null || v === '') return null;
  const s = typeof v === 'string' ? v.trim() : String(v);
  const n = Number(s);
  if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
  let d = new Date(s);
  if (!isNaN(d.getTime())) return d.getTime();
  const eu = s.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/, '$2/$1/$3');
  if (eu !== s) { d = new Date(eu); if (!isNaN(d.getTime())) return d.getTime(); }
  const iso = s.replace(/\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\s*$/i, 'T$1');
  if (iso !== s) { d = new Date(iso); if (!isNaN(d.getTime())) return d.getTime(); }
  return null;
}

/** Formatea timestamp (ms) o cadena de fecha para mostrar como hora legible */
function formatTimeDisplay(v) {
  if (v == null || v === '') return '—';
  const ms = typeof v === 'number' && Number.isFinite(v) ? v : parseTime(v);
  if (ms == null) return escapeHtml(String(v).slice(0, 20));
  const d = new Date(ms);
  if (isNaN(d.getTime())) return escapeHtml(String(v).slice(0, 20));
  return d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Parsea CSV completo: headers, filas, roles de columnas y estadísticas */
function parseCSVFull(content) {
  const raw = normalizeCSVContent(content);
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 1) return null;
  const headerLine = lines[0];
  const sep = detectSeparator(headerLine);
  const headers = parseCSVLine(headerLine, sep).map(h => (h || '').trim());
  if (headers.length === 0 || headers.every(h => !h)) return null;
  const timeIdx = getTimeColumnIndex(headers);
  const latIdx = headers.findIndex(h => LAT_HEADERS.test((h || '').trim()));
  const lonIdx = headers.findIndex(h => LON_HEADERS.test((h || '').trim()));
  const geoIdxs = [timeIdx, latIdx, lonIdx].filter(i => i >= 0);
  const sensorIndices = headers.map((_, i) => i).filter(i => !geoIdxs.includes(i));
  const sensorHeaders = sensorIndices.map(i => headers[i]);

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCSVLine(lines[i], sep);
    const row = {};
    headers.forEach((h, j) => { row[h] = (cells[j] ?? '').trim(); });
    rows.push(row);
  }
  const stats = parseCSVStats(content);
  return { headers, rows, timeIdx, latIdx, lonIdx, sensorIndices, sensorHeaders, stats };
}

/** Construye waypoints para ruta guardada: [{ lat, lon, speedKmh?, ...sensores }] sin perder datos. */
function buildWaypointsFromParsed(parsed) {
  if (!parsed || !parsed.rows || parsed.rows.length === 0) return [];
  const { headers, rows, latIdx, lonIdx, sensorIndices } = parsed;
  if (latIdx < 0 || lonIdx < 0) return [];
  const latKey = headers[latIdx];
  const lonKey = headers[lonIdx];
  const speedIdx = headers.findIndex(h => SPEED_HEADERS.test((h || '').trim()));
  const speedKey = speedIdx >= 0 ? headers[speedIdx] : null;
  const points = [];
  for (const row of rows) {
    const lat = parseFloat(row[latKey]);
    const lon = parseFloat(row[lonKey]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const wp = { lat, lon };
    if (speedKey != null) {
      const v = parseFloat(row[speedKey]);
      if (Number.isFinite(v) && v >= 0) wp.speedKmh = v;
    }
    (sensorIndices || []).forEach(i => {
      const key = headers[i];
      if (!key || key === speedKey) return;
      const v = parseFloat(row[key]);
      if (Number.isFinite(v)) wp[key] = v;
    });
    points.push(wp);
  }
  return points;
}

function getFolderTree(entries) {
  const tree = {};
  for (const e of entries) {
    const parts = e.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    const top = parts[0];
    if (!tree[top]) tree[top] = [];
    tree[top].push(e);
  }
  return tree;
}

function formatFileStats(stats) {
  if (!stats) return '—';
  const parts = [];
  if (stats.firstTime != null && Number.isFinite(stats.firstTime)) {
    parts.push('Inicio: ' + new Date(stats.firstTime).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }));
  }
  parts.push('Sensores: ' + stats.sensors);
  parts.push('Duración log: ' + stats.durationText);
  if (stats.routeKm != null) {
    parts.push('Km ruta: ' + (Math.round(stats.routeKm * 100) / 100));
    parts.push('Duración: ' + stats.durationText);
  }
  return parts.join(' · ');
}

function renderDetailPanel(contentEl, titleEl, name, parsed) {
  if (!contentEl || !parsed) return;
  const { headers, rows, timeIdx, latIdx, lonIdx, sensorIndices, sensorHeaders, stats } = parsed;
  if (titleEl) titleEl.textContent = name;

  let html = '';

  let pathPointsForMap = [];
  html += '<div class="torque-detail-section">';
  html += '<h5>Uso en rutas (Creador de rutas / GPS)</h5>';
  let sensorHeadersForMap = [];
  if (latIdx >= 0 && lonIdx >= 0 && rows.length > 0) {
    const latKey = headers[latIdx];
    const lonKey = headers[lonIdx];
    const timeKey = timeIdx >= 0 ? headers[timeIdx] : null;
    const points = rows.filter(r => Number.isFinite(parseFloat(r[latKey])) && Number.isFinite(parseFloat(r[lonKey])));
    sensorHeadersForMap = sensorHeaders || [];
    pathPointsForMap = points.map(r => {
      const lat = parseFloat(r[latKey]);
      const lng = parseFloat(r[lonKey]);
      const values = {};
      (sensorHeaders || []).forEach(h => {
        const v = parseFloat(r[h]);
        if (Number.isFinite(v)) values[h] = v;
      });
      const timeMs = timeKey ? parseTime(r[timeKey]) : null;
      return { lat, lng, values, timeMs };
    });
    const km = stats.routeKm != null ? (Math.round(stats.routeKm * 100) / 100) : '—';
    html += '<p class="kv">Al importar, de este archivo se obtendrán <strong>' + points.length + ' puntos</strong> (lat, lon).</p>';
    if (stats.firstTime != null && Number.isFinite(stats.firstTime)) {
      html += '<p class="kv"><strong>Fecha y hora de inicio:</strong> ' + formatTimeDisplay(stats.firstTime) + '</p>';
      if (stats.lastTime != null && Number.isFinite(stats.lastTime) && stats.lastTime !== stats.firstTime) {
        html += '<p class="kv"><strong>Fecha y hora de fin:</strong> ' + formatTimeDisplay(stats.lastTime) + '</p>';
      }
    }
    html += '<p class="kv"><strong>Distancia total:</strong> ' + km + ' km · <strong>Duración:</strong> ' + (stats.durationText || '—') + '</p>';
    html += '<p class="kv torque-detail-small">Primeros waypoints:</p>';
    html += '<table class="torque-preview-table"><thead><tr><th>#</th>' + (timeKey ? '<th>Hora</th>' : '') + '<th>Lat</th><th>Lon</th></tr></thead><tbody>';
    const previewPoints = points.slice(0, 10);
    previewPoints.forEach((r, i) => {
      html += '<tr><td>' + (i + 1) + '</td>';
      if (timeKey) html += '<td>' + formatTimeDisplay(r[timeKey]) + '</td>';
      html += '<td>' + escapeHtml(String(r[latKey])) + '</td><td>' + escapeHtml(String(r[lonKey])) + '</td></tr>';
    });
    if (points.length > 10) html += '<tr><td colspan="' + (timeKey ? 4 : 3) + '">… y ' + (points.length - 10) + ' más</td></tr>';
    html += '</tbody></table>';
  } else {
    html += '<p class="kv">Este archivo no tiene columnas de latitud/longitud, no se puede usar como ruta.</p>';
  }
  html += '</div>';

  html += '<div class="torque-detail-section">';
  html += '<h5>Uso en simulador OBD2 (Logger)</h5>';
  html += '<p class="kv">Al importar, podrás reproducir este log en <strong>Emulador OBD2 → pestaña Logger</strong>.</p>';
  if (stats.firstTime != null && Number.isFinite(stats.firstTime)) {
    html += '<p class="kv"><strong>Fecha y hora de inicio:</strong> ' + formatTimeDisplay(stats.firstTime) + '</p>';
  }
  html += '<p class="kv"><strong>Sensores (columnas):</strong> ' + (sensorHeaders.length || 0) + ' · <strong>Duración:</strong> ' + (stats.durationText || '—') + ' · <strong>Filas:</strong> ' + rows.length + '</p>';
  if (sensorHeaders.length > 0) {
    html += '<p class="kv torque-detail-small">Columnas que se usarán como datos OBD: ' + escapeHtml(sensorHeaders.slice(0, 15).join(', ')) + (sensorHeaders.length > 15 ? '…' : '') + '</p>';
    html += '<p class="kv torque-detail-small">Vista previa de datos (primeras filas):</p>';
    const colsToShow = [timeIdx, ...sensorIndices].filter(i => i >= 0).slice(0, 8);
    const showHeaders = colsToShow.map(i => headers[i]);
    html += '<table class="torque-preview-table torque-preview-table--wide"><thead><tr>';
    showHeaders.forEach(h => { html += '<th>' + escapeHtml(h) + '</th>'; });
    html += '</tr></thead><tbody>';
    rows.slice(0, 12).forEach(row => {
      html += '<tr>';
      colsToShow.forEach(i => {
        const raw = row[headers[i]];
        const isTimeCol = i === timeIdx;
        const cell = isTimeCol ? formatTimeDisplay(raw) : escapeHtml(String((raw || '').slice(0, 12)));
        html += '<td>' + cell + '</td>';
      });
      html += '</tr>';
    });
    if (rows.length > 12) html += '<tr><td colspan="' + showHeaders.length + '">… y ' + (rows.length - 12) + ' filas más</td></tr>';
    html += '</tbody></table>';
  }
  html += '</div>';

  contentEl.innerHTML = html;
  const panelCard = contentEl.closest('.torque-detail-card');
  const mapWrap = panelCard ? panelCard.querySelector('#torque-detail-map-wrap') : null;
  if (pathPointsForMap.length > 0 && mapWrap) {
    mapWrap.removeAttribute('aria-hidden');
    showTorqueDetailMap(mapWrap, pathPointsForMap, sensorHeadersForMap);
  } else if (mapWrap) {
    mapWrap.setAttribute('aria-hidden', 'true');
    mapWrap.innerHTML = '';
    if (torqueDetailMapInstance) torqueDetailMapInstance = null;
  }
}

let torqueDetailMapInstance = null;
let torquePreviewMapInstance = null;

async function initTorquePreviewMap(containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const apiKey = (config.googleMapsApiKey || '').trim();
    if (!apiKey) return;
    if (!window.google || !window.google.maps) {
      await new Promise((resolve, reject) => {
        if (window.google && window.google.maps) return resolve();
        const cbName = 'torquePreviewMapCallback';
        window[cbName] = () => { window[cbName] = null; resolve(); };
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&loading=async&callback=' + cbName;
        script.async = true;
        script.onerror = () => reject(new Error('Error al cargar Google Maps'));
        document.head.appendChild(script);
      });
    }
    if (torquePreviewMapInstance) torquePreviewMapInstance = null;
    const map = new window.google.maps.Map(containerEl, {
      center: { lat: 20, lng: 0 },
      zoom: 2,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'greedy',
    });
    torquePreviewMapInstance = map;
  } catch (_) {}
}

function valueToHeatColor(t) {
  t = Math.max(0, Math.min(1, t));
  const h = (1 - t) * 240;
  const s = 85;
  const l = 45;
  return 'hsl(' + Math.round(h) + ',' + s + '%,' + l + '%)';
}

function getHeatMinMax(pathPoints, sensorKey) {
  if (!pathPoints.length || !pathPoints[0].values || !sensorKey) return { min: null, max: null };
  let min = Infinity;
  let max = -Infinity;
  pathPoints.forEach(p => {
    const v = p.values && p.values[sensorKey];
    if (v != null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  });
  return { min: min === Infinity ? null : min, max: max === -Infinity ? null : max };
}

function findClosestPointIndex(pathPoints, latLng) {
  const lat = latLng.lat();
  const lng = latLng.lng();
  let best = 0;
  let bestD = Infinity;
  pathPoints.forEach((p, i) => {
    const d = (p.lat - lat) * (p.lat - lat) + (p.lng - lng) * (p.lng - lng);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function drawDetailMapRoute(map, pathPoints, sensorKey) {
  const path = pathPoints.map(p => ({ lat: p.lat, lng: p.lng }));
  const hasValues = pathPoints.length > 0 && pathPoints[0].values && typeof pathPoints[0].values === 'object';
  const sensors = sensorKey && hasValues ? sensorKey : null;
  if (!sensors) {
    const line = new window.google.maps.Polyline({
      path,
      strokeColor: '#00d4aa',
      strokeOpacity: 1,
      strokeWeight: 4,
    });
    line.setMap(map);
    return [line];
  }
  const values = pathPoints.map(p => (p.values && p.values[sensors] != null) ? p.values[sensors] : null);
  let min = Infinity;
  let max = -Infinity;
  values.forEach(v => {
    if (v != null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  });
  if (min === Infinity) {
    const line = new window.google.maps.Polyline({ path, strokeColor: '#00d4aa', strokeOpacity: 1, strokeWeight: 4 });
    line.setMap(map);
    return [line];
  }
  const range = max - min || 1;
  const lines = [];
  for (let i = 0; i < path.length - 1; i++) {
    const v0 = values[i] != null && Number.isFinite(values[i]) ? values[i] : (values[i - 1] != null ? values[i - 1] : min);
    const v1 = values[i + 1] != null && Number.isFinite(values[i + 1]) ? values[i + 1] : v0;
    const t = ((v0 + v1) / 2 - min) / range;
    const color = valueToHeatColor(t);
    const seg = new window.google.maps.Polyline({
      path: [path[i], path[i + 1]],
      strokeColor: color,
      strokeOpacity: 1,
      strokeWeight: 5,
    });
    seg.setMap(map);
    lines.push(seg);
  }
  return lines;
}

async function showTorqueDetailMap(containerEl, pathPoints, sensorHeaders) {
  if (!containerEl || !pathPoints || pathPoints.length < 2) return;
  const sensors = sensorHeaders && sensorHeaders.length > 0 ? sensorHeaders : [];
  const mapActionsPreserved = document.getElementById('torque-detail-map-actions');
  if (mapActionsPreserved) mapActionsPreserved.remove();
  containerEl.innerHTML = '';
  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    const apiKey = (config.googleMapsApiKey || '').trim();
    if (!apiKey) {
      containerEl.innerHTML = '<p class="kv torque-detail-small">Configura <code>GOOGLE_MAPS_API_KEY</code> en .env para ver el mapa.</p>';
      return;
    }
    if (!window.google || !window.google.maps) {
      await new Promise((resolve, reject) => {
        if (window.google && window.google.maps) return resolve();
        const cbName = 'torqueMapCallback';
        window[cbName] = () => { window[cbName] = null; resolve(); };
        const script = document.createElement('script');
        script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(apiKey) + '&loading=async&callback=' + cbName;
        script.async = true;
        script.onerror = () => reject(new Error('Error al cargar Google Maps'));
        document.head.appendChild(script);
      });
    }
    if (torqueDetailMapInstance) torqueDetailMapInstance = null;
    const bounds = new window.google.maps.LatLngBounds();
    pathPoints.forEach(p => bounds.extend({ lat: p.lat, lng: p.lng }));
    const mapWrapper = document.createElement('div');
    mapWrapper.className = 'torque-detail-map-wrapper';
    mapWrapper.style.position = 'relative';
    mapWrapper.style.width = '100%';
    mapWrapper.style.height = '100%';
    const mapDiv = document.createElement('div');
    mapDiv.className = 'torque-detail-map-inner';
    mapDiv.style.width = '100%';
    mapDiv.style.height = '100%';
    mapWrapper.appendChild(mapDiv);
    containerEl.style.display = 'flex';
    containerEl.style.flexDirection = 'column';
    mapWrapper.style.flex = '1';
    mapWrapper.style.minHeight = '0';
    if (sensors.length > 0) {
      const bar = document.createElement('div');
      bar.className = 'torque-detail-heat-control';
      bar.innerHTML = '<label for="torque-heat-sensor">Color por sensor:</label> ';
      const select = document.createElement('select');
      select.id = 'torque-heat-sensor';
      select.className = 'torque-heat-sensor-select';
      const opt0 = document.createElement('option');
      opt0.value = '';
      opt0.textContent = 'Ninguno (línea fija)';
      select.appendChild(opt0);
      sensors.forEach(h => {
        const opt = document.createElement('option');
        opt.value = h;
        opt.textContent = h;
        select.appendChild(opt);
      });
      bar.appendChild(select);
      containerEl.appendChild(bar);
    }
    containerEl.appendChild(mapWrapper);
    const map = new window.google.maps.Map(mapDiv, {
      center: pathPoints[Math.floor(pathPoints.length / 2)],
      zoom: 14,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'greedy',
    });
    let currentLines = [];
    const legendEl = document.createElement('div');
    legendEl.className = 'torque-detail-heat-legend';
    legendEl.style.display = 'none';
    mapWrapper.appendChild(legendEl);
    const tooltipEl = document.createElement('div');
    tooltipEl.className = 'torque-detail-heat-tooltip';
    tooltipEl.style.display = 'none';
    mapWrapper.appendChild(tooltipEl);
    const pointInfoEl = document.createElement('div');
    pointInfoEl.className = 'torque-detail-point-info';
    pointInfoEl.style.display = 'none';
    const pointInfoContent = document.createElement('div');
    pointInfoContent.className = 'torque-detail-point-info-content';
    const pointInfoClose = document.createElement('button');
    pointInfoClose.type = 'button';
    pointInfoClose.className = 'torque-detail-point-info-close';
    pointInfoClose.textContent = 'Cerrar';
    pointInfoEl.appendChild(pointInfoContent);
    pointInfoEl.appendChild(pointInfoClose);
    mapWrapper.appendChild(pointInfoEl);
    function showPointInfo(latLng) {
      const idx = findClosestPointIndex(pathPoints, latLng);
      const p = pathPoints[idx];
      if (!p) { pointInfoEl.style.display = 'none'; return; }
      let html = '<p class="torque-point-info-title">Punto #' + (idx + 1) + '</p>';
      if (p.timeMs != null && Number.isFinite(p.timeMs)) {
        const timeStr = new Date(p.timeMs).toLocaleString('es', { dateStyle: 'short', timeStyle: 'medium' });
        html += '<p class="kv"><strong>Hora:</strong> ' + escapeHtml(timeStr) + '</p>';
      }
      html += '<p class="kv"><strong>Lat:</strong> ' + (typeof p.lat === 'number' ? p.lat.toFixed(6) : p.lat) + ' · <strong>Lon:</strong> ' + (typeof p.lng === 'number' ? p.lng.toFixed(6) : p.lng) + '</p>';
      if (p.values && typeof p.values === 'object' && Object.keys(p.values).length > 0) {
        html += '<p class="torque-point-info-sensors">Sensores:</p><ul class="torque-point-info-list">';
        Object.keys(p.values).sort().forEach(k => {
          const v = p.values[k];
          const text = (typeof v === 'number' && v % 1 !== 0) ? v.toFixed(2) : String(v);
          html += '<li><strong>' + escapeHtml(k) + ':</strong> ' + escapeHtml(text) + '</li>';
        });
        html += '</ul>';
      }
      pointInfoContent.innerHTML = html;
      pointInfoEl.style.display = 'block';
    }
    function hidePointInfo() { pointInfoEl.style.display = 'none'; }
    pointInfoClose.addEventListener('click', hidePointInfo);
    map.addListener('click', (e) => { if (e && e.latLng) showPointInfo(e.latLng); });
    function updateRoute() {
      currentLines.forEach(l => l.setMap(null));
      const sel = document.getElementById('torque-heat-sensor');
      const sensorKey = sel ? (sel.value || null) : null;
      currentLines = drawDetailMapRoute(map, pathPoints, sensorKey);
      if (sensorKey && pathPoints.length > 0 && pathPoints[0].values) {
        const { min, max } = getHeatMinMax(pathPoints, sensorKey);
        if (min != null && max != null) {
          legendEl.style.display = 'block';
          legendEl.innerHTML = '<span class="torque-legend-label">' + escapeHtml(sensorKey) + ':</span> <span class="torque-legend-bar"></span> <span class="torque-legend-min">' + (typeof min === 'number' && min % 1 !== 0 ? min.toFixed(1) : min) + '</span> <span class="torque-legend-max">' + (typeof max === 'number' && max % 1 !== 0 ? max.toFixed(1) : max) + '</span>';
        } else {
          legendEl.style.display = 'none';
        }
      } else {
        legendEl.style.display = 'none';
      }
    }
    function updateTooltip(latLng) {
      const sel = document.getElementById('torque-heat-sensor');
      const sensorKey = sel ? (sel.value || null) : null;
      if (!sensorKey || !pathPoints.length) { tooltipEl.style.display = 'none'; return; }
      const idx = findClosestPointIndex(pathPoints, latLng);
      const p = pathPoints[idx];
      const v = p.values && p.values[sensorKey];
      if (v == null || !Number.isFinite(v)) { tooltipEl.style.display = 'none'; return; }
      const text = (typeof v === 'number' && v % 1 !== 0) ? v.toFixed(2) : String(v);
      tooltipEl.textContent = sensorKey + ': ' + text;
      tooltipEl.style.display = 'block';
    }
    map.addListener('mousemove', (e) => { if (e && e.latLng) updateTooltip(e.latLng); });
    map.addListener('mouseout', () => { tooltipEl.style.display = 'none'; });
    mapWrapper.addEventListener('mousemove', (e) => {
      const rect = mapWrapper.getBoundingClientRect();
      tooltipEl.style.left = Math.min(e.clientX - rect.left + 12, rect.width - 120) + 'px';
      tooltipEl.style.top = (e.clientY - rect.top + 8) + 'px';
    });
    updateRoute();
    const sel = document.getElementById('torque-heat-sensor');
    if (sel) sel.addEventListener('change', updateRoute);
    map.fitBounds(bounds, 32);

    // Marcadores inicio / fin
    const startMarker = new window.google.maps.Marker({
      position: pathPoints[0],
      map,
      label: { text: 'Inicio', color: '#fff', fontSize: '11px' },
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#22c55e', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });
    const endMarker = new window.google.maps.Marker({
      position: pathPoints[pathPoints.length - 1],
      map,
      label: { text: 'Fin', color: '#fff', fontSize: '11px' },
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 11, fillColor: '#ef4444', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
    });

    // Reproducción de ruta: marcador móvil y barra
    const playbackMarker = new window.google.maps.Marker({
      position: pathPoints[0],
      map,
      icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#00d4aa', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
      zIndex: 100,
    });
    const firstMs = pathPoints[0] && pathPoints[0].timeMs != null && Number.isFinite(pathPoints[0].timeMs) ? pathPoints[0].timeMs : null;
    const lastMs = pathPoints.length > 0 && pathPoints[pathPoints.length - 1].timeMs != null && Number.isFinite(pathPoints[pathPoints.length - 1].timeMs) ? pathPoints[pathPoints.length - 1].timeMs : null;
    const hasTimeStamps = firstMs != null && lastMs != null && lastMs > firstMs;
    const routeDurationSec = hasTimeStamps ? (lastMs - firstMs) / 1000 : 30;
    let playProgress = 0;
    let playStartTime = 0;
    let playStartProgress = 0;
    let playing = false;
    let playSpeed = 1;
    let animId = null;

    function getPlaybackIndex() {
      return Math.min(Math.floor(playProgress * pathPoints.length), pathPoints.length - 1);
    }
    function progressFromSimulatedTime(simulatedMs) {
      if (!hasTimeStamps || simulatedMs >= lastMs) return 1;
      if (simulatedMs <= firstMs) return 0;
      for (let i = 0; i < pathPoints.length - 1; i++) {
        const t0 = pathPoints[i].timeMs;
        const t1 = pathPoints[i + 1].timeMs;
        if (t0 == null || t1 == null) continue;
        if (simulatedMs >= t0 && simulatedMs <= t1) {
          const seg = (t1 - t0) || 1;
          return (i + (simulatedMs - t0) / seg) / pathPoints.length;
        }
      }
      return 1;
    }
    function setPlaybackProgress(p) {
      playProgress = Math.max(0, Math.min(1, p));
      const idx = getPlaybackIndex();
      playbackMarker.setPosition(pathPoints[idx]);
    }
    function updatePlaybackUI() {
      const idx = getPlaybackIndex();
      if (playbackSlider) playbackSlider.value = Math.round(playProgress * 100);
      if (playbackLabel) playbackLabel.textContent = 'Punto ' + (idx + 1) + ' / ' + pathPoints.length;
    }
    function tick() {
      if (!playing) return;
      const elapsed = (Date.now() - playStartTime) / 1000;
      if (hasTimeStamps) {
        const simulatedElapsed = elapsed * playSpeed;
        const simulatedMs = firstMs + playStartProgress * (lastMs - firstMs) + simulatedElapsed * 1000;
        if (simulatedMs >= lastMs) {
          playProgress = 1;
          playing = false;
          if (playBtn) playBtn.style.display = '';
          if (pauseBtn) pauseBtn.style.display = 'none';
          setPlaybackProgress(1);
          updatePlaybackUI();
          return;
        }
        playProgress = progressFromSimulatedTime(simulatedMs);
      } else {
        const totalDur = routeDurationSec / playSpeed;
        const p = playProgress + elapsed / totalDur;
        if (p >= 1) {
          playProgress = 1;
          playing = false;
          if (playBtn) playBtn.style.display = '';
          if (pauseBtn) pauseBtn.style.display = 'none';
          setPlaybackProgress(1);
          updatePlaybackUI();
          return;
        }
        playProgress = p;
      }
      setPlaybackProgress(playProgress);
      updatePlaybackUI();
      animId = requestAnimationFrame(tick);
    }
    function startPlayback() {
      playing = true;
      playStartTime = Date.now();
      playStartProgress = playProgress;
      if (playBtn) playBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = '';
      animId = requestAnimationFrame(tick);
    }
    function stopPlayback() {
      playing = false;
      if (animId != null) cancelAnimationFrame(animId);
      animId = null;
      if (playBtn) playBtn.style.display = '';
      if (pauseBtn) pauseBtn.style.display = 'none';
    }

    const playbackBar = document.createElement('div');
    playbackBar.className = 'torque-playback-bar';
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'torque-playback-btn';
    playBtn.setAttribute('aria-label', 'Reproducir');
    playBtn.title = 'Reproducir';
    playBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-play"/></svg><span class="torque-playback-btn-text">Reproducir</span>';
    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = 'torque-playback-btn';
    pauseBtn.setAttribute('aria-label', 'Pausar');
    pauseBtn.title = 'Pausar';
    pauseBtn.style.display = 'none';
    pauseBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-stop"/></svg><span class="torque-playback-btn-text">Pausar</span>';
    const playbackSlider = document.createElement('input');
    playbackSlider.type = 'range';
    playbackSlider.className = 'torque-playback-slider';
    playbackSlider.min = 0;
    playbackSlider.max = 100;
    playbackSlider.value = 0;
    const speedSelect = document.createElement('select');
    speedSelect.className = 'torque-heat-sensor-select torque-playback-speed';
    speedSelect.innerHTML = '<option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option>';
    const playbackLabel = document.createElement('span');
    playbackLabel.className = 'torque-playback-label';
    playbackLabel.textContent = 'Punto 1 / ' + pathPoints.length;

    playBtn.addEventListener('click', () => { if (!playing) startPlayback(); });
    pauseBtn.addEventListener('click', stopPlayback);
    playbackSlider.addEventListener('input', () => {
      stopPlayback();
      playProgress = parseInt(playbackSlider.value, 10) / 100;
      setPlaybackProgress(playProgress);
      updatePlaybackUI();
    });
    speedSelect.addEventListener('change', () => { playSpeed = parseFloat(speedSelect.value) || 1; });

    playbackBar.appendChild(playBtn);
    playbackBar.appendChild(pauseBtn);
    playbackBar.appendChild(playbackSlider);
    playbackBar.appendChild(speedSelect);
    playbackBar.appendChild(playbackLabel);
    const bottomRow = document.createElement('div');
    bottomRow.className = 'torque-detail-bottom-row';
    bottomRow.appendChild(playbackBar);
    if (mapActionsPreserved) {
      mapActionsPreserved.style.display = 'block';
      bottomRow.appendChild(mapActionsPreserved);
    }
    containerEl.appendChild(bottomRow);
    updatePlaybackUI();

    torqueDetailMapInstance = map;
  } catch (err) {
    containerEl.innerHTML = '<p class="kv torque-import-status--error">No se pudo cargar el mapa: ' + escapeHtml(err.message || '') + '</p>';
  }
}

function getDefaultFilters() {
  return {
    minDurationMin: 0,
    minDistanceKm: 0,
    onlyWithGps: false,
    dateFrom: null,
    dateTo: null,
  };
}

function passesFileFilter(stats, filters) {
  if (!filters) return true;
  if (filters.onlyWithGps && (stats == null || stats.routeKm == null)) return false;
  if (filters.minDurationMin > 0 && stats != null && (stats.durationMin ?? 0) < filters.minDurationMin) return false;
  if (filters.minDistanceKm > 0 && stats != null && (stats.routeKm ?? 0) < filters.minDistanceKm) return false;
  if (filters.dateFrom != null && stats != null && stats.lastTime != null && stats.lastTime < filters.dateFrom) return false;
  if (filters.dateTo != null && stats != null && stats.firstTime != null && stats.firstTime > filters.dateTo) return false;
  return true;
}

function getFiltersFromDOM() {
  const minDur = document.getElementById('torque-filter-min-duration');
  const minDist = document.getElementById('torque-filter-min-distance');
  const onlyGps = document.getElementById('torque-filter-only-gps');
  const dateFromEl = document.getElementById('torque-filter-date-from');
  const dateToEl = document.getElementById('torque-filter-date-to');
  let dateFrom = null;
  let dateTo = null;
  if (dateFromEl && dateFromEl.value) {
    const d = new Date(dateFromEl.value + 'T00:00:00');
    if (!isNaN(d.getTime())) dateFrom = d.getTime();
  }
  if (dateToEl && dateToEl.value) {
    const d = new Date(dateToEl.value + 'T23:59:59.999');
    if (!isNaN(d.getTime())) dateTo = d.getTime();
  }
  return {
    minDurationMin: minDur ? parseFloat(minDur.value) || 0 : 0,
    minDistanceKm: minDist ? parseFloat(minDist.value) || 0 : 0,
    onlyWithGps: onlyGps ? !!onlyGps.checked : false,
    dateFrom,
    dateTo,
  };
}

function renderPreview(treeEl, tree, statsByPath, filters) {
  const nameByPath = {};
  treeEl.querySelectorAll('.torque-file-name-input').forEach(inp => {
    const p = inp.dataset.path;
    if (p) nameByPath[p] = inp.value.trim();
  });
  const f = filters != null ? filters : getFiltersFromDOM();
  const folders = Object.keys(tree).sort();
  let html = '';
  for (const folder of folders) {
    const files = tree[folder];
    const visibleFiles = files.filter(fil => passesFileFilter(statsByPath && statsByPath[fil.path], f));
    if (visibleFiles.length === 0) continue;
    const id = 'torque-folder-' + folder.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileIds = visibleFiles.map(fil => 'torque-file-' + fil.path.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80));
    html += '<div class="torque-folder">';
    html += '<label class="torque-folder-label">';
    html += '<input type="checkbox" class="torque-folder-cb" id="' + id + '" data-folder="' + escapeHtml(folder) + '" data-files="' + escapeHtml(fileIds.join(',')) + '"> ';
    html += '<strong>' + escapeHtml(folder) + '</strong> (' + visibleFiles.length + (visibleFiles.length !== files.length ? ' de ' + files.length : '') + ' archivo' + (visibleFiles.length !== 1 ? 's' : '') + ')';
    html += '</label>';
    html += '<ul class="torque-file-list">';
    for (const fil of visibleFiles) {
      const fid = 'torque-file-' + fil.path.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
      const stats = statsByPath && statsByPath[fil.path];
      const statsStr = stats ? formatFileStats(stats) : 'Analizando…';
      const currentName = nameByPath[fil.path] != null && nameByPath[fil.path] !== '' ? nameByPath[fil.path] : '';
      html += '<li class="torque-file-row">';
      html += '<label class="torque-file-label">';
      html += '<input type="checkbox" class="torque-file-cb" id="' + fid + '" data-path="' + escapeHtml(fil.path) + '"> ';
      html += '<span class="torque-file-name">' + escapeHtml(fil.name) + '</span>';
      html += '</label>';
      html += '<div class="torque-file-meta">';
      html += '<span class="torque-file-stats">' + escapeHtml(statsStr) + '</span>';
      html += '<input type="text" class="torque-file-name-input" data-path="' + escapeHtml(fil.path) + '" value="' + escapeHtml(currentName) + '" placeholder="Inicio ruta - Fin ruta" maxlength="200" title="Nombre: inicio - fin de ruta">';
      html += '<button type="button" class="btn btn-ghost torque-detail-btn" data-path="' + escapeHtml(fil.path) + '" data-name="' + escapeHtml(fil.name) + '" title="Ver vista previa detallada">Ver detalle</button>';
      html += '</div>';
      html += '</li>';
    }
    html += '</ul></div>';
  }
  const noMatchMsg = Object.keys(tree).length === 0
    ? '<p class="kv">No se encontraron archivos CSV útiles.</p>'
    : '<p class="kv">No hay archivos que cumplan los filtros. Ajusta los filtros o desactívalos.</p>';
  treeEl.innerHTML = html || noMatchMsg;

  treeEl.querySelectorAll('.torque-folder-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const fileIds = (cb.dataset.files || '').split(',').filter(Boolean);
      fileIds.forEach(fid => {
        const el = document.getElementById(fid);
        if (el) el.checked = cb.checked;
      });
      updateImportButton();
    });
  });
  treeEl.querySelectorAll('.torque-file-cb').forEach(cb => {
    cb.addEventListener('change', () => updateImportButton());
  });
}

function bindDetailButtons(containerEl, detailPanel, detailTitle, detailContent, closeBtn, previewMapWrap) {
  if (!detailPanel) return;
  function showDetail() {
    if (previewMapWrap) previewMapWrap.style.display = 'none';
    detailPanel.style.display = 'block';
    detailPanel.setAttribute('aria-hidden', 'false');
  }
  const detailPanelEl = document.getElementById('torque-detail-panel');
  function hideDetail() {
    detailPanel.style.display = 'none';
    detailPanel.setAttribute('aria-hidden', 'true');
    const popupBackdrop = document.getElementById('torque-detail-popup-backdrop');
    if (popupBackdrop) {
      popupBackdrop.style.display = 'none';
      popupBackdrop.setAttribute('aria-hidden', 'true');
      if (popupBackdrop.parentNode === document.body && detailPanelEl) detailPanelEl.appendChild(popupBackdrop);
    }
    const verDatosBtn = document.getElementById('torque-detail-ver-datos');
    if (verDatosBtn) verDatosBtn.textContent = 'Ver datos';
    if (previewMapWrap) previewMapWrap.style.display = 'block';
  }
  const popupBackdrop = document.getElementById('torque-detail-popup-backdrop');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (popupBackdrop && popupBackdrop.style.display !== 'none') {
        popupBackdrop.style.display = 'none';
        popupBackdrop.setAttribute('aria-hidden', 'true');
        if (popupBackdrop.parentNode === document.body && detailPanelEl) detailPanelEl.appendChild(popupBackdrop);
        const verDatosBtn = document.getElementById('torque-detail-ver-datos');
        if (verDatosBtn) verDatosBtn.textContent = 'Ver datos';
      } else {
        hideDetail();
      }
    });
  }
  const mapActions = document.getElementById('torque-detail-map-actions');
  const verDatosBtn = document.getElementById('torque-detail-ver-datos');
  if (verDatosBtn && popupBackdrop && mapActions) {
    verDatosBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = popupBackdrop.style.display !== 'none';
      if (isOpen) {
        popupBackdrop.style.display = 'none';
        popupBackdrop.setAttribute('aria-hidden', 'true');
        if (popupBackdrop.parentNode === document.body && detailPanelEl) detailPanelEl.appendChild(popupBackdrop);
        verDatosBtn.textContent = 'Ver datos';
      } else {
        if (popupBackdrop.parentNode !== document.body) document.body.appendChild(popupBackdrop);
        popupBackdrop.style.display = 'flex';
        popupBackdrop.setAttribute('aria-hidden', 'false');
        verDatosBtn.textContent = 'Ocultar datos';
      }
    });
    if (popupBackdrop) {
      popupBackdrop.addEventListener('click', (e) => {
        if (e.target === popupBackdrop) {
          popupBackdrop.style.display = 'none';
          popupBackdrop.setAttribute('aria-hidden', 'true');
          if (popupBackdrop.parentNode === document.body && detailPanelEl) detailPanelEl.appendChild(popupBackdrop);
          verDatosBtn.textContent = 'Ver datos';
        }
      });
    }
  }
  function handleVerDetalleClick(e) {
    const btn = e.target.closest('.torque-detail-btn');
    if (!btn) return;
    const tree = document.getElementById('torque-preview-tree');
    if (!tree || !tree.contains(btn)) return;
    if (!zipInstance) return;
    e.preventDefault();
    e.stopPropagation();
    const path = (btn.getAttribute('data-path') || btn.dataset.path || '').trim();
    const name = (btn.getAttribute('data-name') || btn.dataset.name || path.split('/').pop() || path).trim();
    if (!path) {
      detailContent.innerHTML = '<p class="kv torque-import-status--error">Ruta del archivo no disponible.</p>';
      showDetail();
      return;
    }
    detailContent.innerHTML = '<p class="kv">Cargando…</p>';
    detailTitle.textContent = name || 'Vista previa detallada';
    showDetail();
    (async () => {
      try {
        let entry = zipInstance.file(path);
        if (!entry) {
          const altPath = path.replace(/\\/g, '/');
          entry = zipInstance.file(altPath);
        }
        if (!entry) {
          detailContent.innerHTML = '<p class="kv torque-import-status--error">Archivo no encontrado en el ZIP: ' + escapeHtml(path) + '</p>';
          return;
        }
        const content = await entry.async('string');
        const parsed = parseCSVFull(content);
        if (!parsed) {
          detailContent.innerHTML = '<p class="kv torque-import-status--error">No se pudo leer el CSV (formato o codificación no reconocidos).</p>';
          return;
        }
        renderDetailPanel(detailContent, detailTitle, name, parsed);
        const panel = detailContent.closest('#torque-detail-panel');
        const mapWrap = panel && panel.querySelector('#torque-detail-map-wrap');
        const hasMap = mapWrap && mapWrap.getAttribute('aria-hidden') !== 'true';
        const innerPanelEl = document.getElementById('torque-detail-inner-panel');
        const mapActionsEl = document.getElementById('torque-detail-map-actions');
        const verDatosBtnEl = document.getElementById('torque-detail-ver-datos');
        const popupBackdropEl = document.getElementById('torque-detail-popup-backdrop');
        if (popupBackdropEl && mapActionsEl && verDatosBtnEl) {
          if (hasMap) {
            popupBackdropEl.style.display = 'none';
            popupBackdropEl.setAttribute('aria-hidden', 'true');
            mapActionsEl.style.display = 'block';
            verDatosBtnEl.textContent = 'Ver datos';
          } else {
            if (popupBackdropEl.parentNode !== document.body) document.body.appendChild(popupBackdropEl);
            popupBackdropEl.style.display = 'flex';
            popupBackdropEl.setAttribute('aria-hidden', 'false');
            mapActionsEl.style.display = 'none';
          }
        }
      } catch (err) {
        detailContent.innerHTML = '<p class="kv torque-import-status--error">Error: ' + escapeHtml(err.message || 'desconocido') + '</p>';
      }
    })();
  }
  document.addEventListener('click', handleVerDetalleClick, true);
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function updateImportButton() {
  const btn = $('torque-import-btn');
  const label = $('torque-import-btn-label');
  const count = (document.querySelectorAll('.torque-file-cb:checked') || []).length;
  if (btn) btn.disabled = count === 0;
  if (label) label.textContent = count > 0 ? `Importar selección (${count} archivo${count !== 1 ? 's' : ''})` : 'Importar selección';
  updateDefaultTitle();
}

async function updateDefaultTitle() {
  if (!zipInstance) return;
  const inputs = document.querySelectorAll('.torque-file-name-input');
  let apiKey = '';
  try {
    const configRes = await fetch('/api/config');
    const config = await configRes.json();
    apiKey = (config.googleMapsApiKey || '').trim();
  } catch (_) {}
  for (const input of inputs) {
    const path = input.dataset.path;
    if (!path || input.value.trim() !== '') continue;
    try {
      const entry = zipInstance.file(path);
      if (!entry) continue;
      const content = await entry.async('string');
      const parsed = parseCSVFull(content);
      if (!parsed) continue;
      const { headers, rows, latIdx, lonIdx, stats } = parsed;
      const hasLatLon = latIdx >= 0 && lonIdx >= 0;
      const points = hasLatLon ? rows.filter(r => Number.isFinite(parseFloat(r[headers[latIdx]])) && Number.isFinite(parseFloat(r[headers[lonIdx]]))) : [];
      let defaultName = '';
      if (points.length >= 2 && apiKey) {
        const firstLat = parseFloat(points[0][headers[latIdx]]);
        const firstLon = parseFloat(points[0][headers[lonIdx]]);
        const lastLat = parseFloat(points[points.length - 1][headers[latIdx]]);
        const lastLon = parseFloat(points[points.length - 1][headers[lonIdx]]);
        if (Number.isFinite(firstLat) && Number.isFinite(firstLon) && Number.isFinite(lastLat) && Number.isFinite(lastLon)) {
          const placeStart = await getPlaceName(firstLat, firstLon, apiKey);
          const placeEnd = await getPlaceName(lastLat, lastLon, apiKey);
          defaultName = [placeStart || 'Inicio', placeEnd || 'Fin'].join(' - ');
        }
      }
      if (!defaultName && stats && stats.firstTime != null && stats.lastTime != null) {
        const d1 = new Date(stats.firstTime);
        const d2 = new Date(stats.lastTime);
        const fmt = d => d.toLocaleString('es', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        defaultName = fmt(d1) + ' - ' + fmt(d2);
      }
      if (!defaultName) defaultName = (path.split('/').pop() || path).replace(/\.csv$/i, '');
      input.value = defaultName;
    } catch (_) { /* ignorar errores por archivo */ }
  }
}

function setStatus(msg, isError = false) {
  const el = $('torque-import-status');
  if (el) {
    el.textContent = msg;
    el.className = 'torque-import-status' + (isError ? ' torque-import-status--error' : '');
  }
}

export function initImportTorque() {
  const input = $('torque-zip-input');
  const previewCard = $('torque-preview-card');
  const previewTree = $('torque-preview-tree');
  const importBtn = $('torque-import-btn');
  const detailPanel = $('torque-detail-panel');
  const detailTitle = $('torque-detail-title');
  const detailContent = $('torque-detail-content');
  const detailClose = $('torque-detail-close');

  let currentTree = {};
  let currentStatsByPath = {};

  if (!input || !previewCard || !previewTree) return;
  const previewMapWrap = $('torque-preview-map-wrap');
  bindDetailButtons(previewCard, detailPanel, detailTitle, detailContent, detailClose, previewMapWrap);

  function applyFiltersAndRender() {
    renderPreview(previewTree, currentTree, currentStatsByPath, getFiltersFromDOM());
    updateImportButton();
  }

  const filterMinDur = $('torque-filter-min-duration');
  const filterMinDist = $('torque-filter-min-distance');
  const filterOnlyGps = $('torque-filter-only-gps');
  const filterDateFrom = $('torque-filter-date-from');
  const filterDateTo = $('torque-filter-date-to');
  [filterMinDur, filterMinDist, filterOnlyGps, filterDateFrom, filterDateTo].forEach(el => {
    if (el) el.addEventListener('change', applyFiltersAndRender);
    if (el && el.type === 'number') el.addEventListener('input', applyFiltersAndRender);
  });

  input.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    zipInstance = null;
    previewCard.style.display = 'none';
    setStatus('');
    if (!file || !file.name.toLowerCase().endsWith('.zip')) {
      if (file) setStatus('Selecciona un archivo .zip', true);
      return;
    }
    if (typeof window.JSZip === 'undefined') {
      setStatus('Cargando librería ZIP…');
      await new Promise(r => setTimeout(r, 500));
      if (typeof window.JSZip === 'undefined') {
        setStatus('Falta la librería JSZip. Recarga la página.', true);
        return;
      }
    }
    setStatus('Leyendo ZIP…');
    try {
      const zip = await window.JSZip.loadAsync(file);
      zipInstance = zip;
      const allEntries = [];
      zip.forEach((relativePath, entry) => {
        if (!entry.dir && CSV_EXT.test(relativePath)) {
          const name = relativePath.split('/').pop() || relativePath;
          allEntries.push({ path: relativePath, name });
        }
      });
      const tree = getFolderTree(allEntries);
      currentTree = tree;
      currentStatsByPath = {};
      renderPreview(previewTree, currentTree, currentStatsByPath);
      previewCard.style.display = 'block';
      const previewMapWrap = $('torque-preview-map-wrap');
      if (previewMapWrap) initTorquePreviewMap(previewMapWrap);
      setStatus(allEntries.length + ' CSV en ' + Object.keys(tree).length + ' carpeta(s). Analizando…');
      updateImportButton();

      const statsByPath = {};
      for (const e of allEntries) {
        try {
          const entry = zip.file(e.path);
          if (!entry) continue;
          const content = await entry.async('string');
          const stats = parseCSVStats(content);
          statsByPath[e.path] = stats;
        } catch (_) {
          statsByPath[e.path] = null;
        }
      }
      currentStatsByPath = statsByPath;
      renderPreview(previewTree, currentTree, currentStatsByPath);
      updateImportButton();
      setStatus(allEntries.length + ' archivo(s) CSV. Sensores, duración y km calculados. Elige qué importar.');
    } catch (err) {
      setStatus('Error al leer el ZIP: ' + (err.message || 'desconocido'), true);
    }
  });

  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const checked = document.querySelectorAll('.torque-file-cb:checked');
      if (!zipInstance || checked.length === 0) return;
      const paths = Array.from(checked).map(cb => cb.dataset.path).filter(Boolean);
      const usedPaths = new Set();
      const files = [];
      for (const relPath of paths) {
        const entry = zipInstance.file(relPath);
        if (!entry) continue;
        const nameEl = Array.from(document.querySelectorAll('.torque-file-name-input')).find(el => el.dataset.path === relPath);
        const rawName = (nameEl && nameEl.value && nameEl.value.trim()) ? nameEl.value.trim() : (relPath.split('/').pop() || relPath).replace(/\.csv$/i, '');
        let savePath = sanitizeTitleForPath(rawName) || 'ruta';
        savePath = savePath + '.csv';
        while (usedPaths.has(savePath)) {
          const base = savePath.replace(/\.csv$/i, '');
          const m = base.match(/^(.*)\s*\((\d+)\)$/);
          const n = m ? parseInt(m[2], 10) + 1 : 2;
          const prefix = m ? m[1] : base;
          savePath = prefix.trim() + ' (' + n + ').csv';
        }
        usedPaths.add(savePath);
        const content = await entry.async('string');
        files.push({ path: savePath, content, routeName: rawName });
      }
      if (files.length === 0) return;
      setStatus('Importando ' + files.length + ' archivo(s)…');
      importBtn.disabled = true;
      try {
        const data = await fetch('/api/torque-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: files.map(({ path, content }) => ({ path, content })) }),
        }).then(r => r.json().then(body => ({ ok: r.ok, ...body })));
        if (data.ok) {
          const saved = (data.saved || []).length;
          const errs = (data.errors || []).length;
          let routesCreated = 0;
          for (let i = 0; i < files.length; i++) {
            const f = files[i];
            const parsed = parseCSVFull(f.content);
            const waypoints = parsed ? buildWaypointsFromParsed(parsed) : [];
            if (waypoints.length >= 2) {
              const routeName = (f.routeName && String(f.routeName).trim()) || (f.path.replace(/\.csv$/i, ''));
              try {
                const r = await fetch('/api/saved-routes', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: routeName, waypoints }),
                });
                const res = await r.json().catch(() => ({}));
                if (res.ok) routesCreated++;
              } catch (_) {}
            }
          }
          const msg = 'Importación correcta: ' + saved + ' archivo(s) guardado(s)' + (routesCreated ? ', ' + routesCreated + ' ruta(s) creada(s)' : '') + (errs ? '. ' + errs + ' error(es).' : '.');
          setStatus(msg);
          alert(msg + '\n\nAl pulsar Aceptar se recargará la página.');
          window.location.reload();
        } else {
          setStatus((data.error || 'Error al importar'), true);
        }
        importBtn.disabled = false;
        updateImportButton();
      } catch (err) {
        setStatus('Error: ' + (err.message || 'desconocido'), true);
        importBtn.disabled = false;
      }
    });
  }
}
