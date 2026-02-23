/**
 * Creador de rutas: inicio, fin, paradas intermedias.
 * Genera la ruta por carretera (Directions API). Marcadores arrastrables y eliminables.
 */
import { api, $ } from '../api.js';

let mapInstance = null;
let directionsService = null;
let directionsRenderer = null;
let startMarker = null;
let endMarker = null;
let waypointMarkers = [];
let currentMode = 'start';
let startPos = null;
let endPos = null;
let waypoints = [];
let routePath = [];
let routePathPolyline = null;
let editingRouteId = null;
let mapLoadPromise = null;
let loadedRoutePathPoints = [];
let loadedRouteSensorKeys = [];
let routeHeatPolylines = [];
let routeClickPolyline = null;
let editingPointIndex = null;
const DEFAULT_CENTER = { lat: 4.711, lng: -74.072 };

function valueToHeatColor(t) {
  const h = (1 - Math.max(0, Math.min(1, t))) * 240;
  return 'hsl(' + Math.round(h) + ', 85%, 45%)';
}

function getSensorKeysFromWaypoints(pts) {
  if (!pts || pts.length === 0) return [];
  const first = pts[0];
  const keys = Object.keys(first).filter(k => k !== 'lat' && k !== 'lon');
  const hasNumeric = (wp, key) => {
    const v = wp[key];
    return v != null && (typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(parseFloat(v)));
  };
  return keys.filter(key => pts.some(wp => hasNumeric(wp, key)));
}

function buildPathPointsWithValues(pts) {
  const sensorKeys = getSensorKeysFromWaypoints(pts);
  if (sensorKeys.length === 0) return pts.map(p => ({ lat: p.lat, lng: p.lon, values: {} }));
  return pts.map(p => {
    const values = {};
    sensorKeys.forEach(k => {
      const v = p[k];
      if (v != null && (typeof v === 'number' ? Number.isFinite(v) : Number.isFinite(parseFloat(v)))) values[k] = typeof v === 'number' ? v : parseFloat(v);
    });
    return { lat: p.lat, lng: p.lon != null ? p.lon : p.lng, values };
  });
}

function clearRouteHeatPolylines() {
  routeHeatPolylines.forEach(line => { if (line && line.setMap) line.setMap(null); });
  routeHeatPolylines = [];
}

function clearRouteClickPolyline() {
  if (routeClickPolyline) {
    if (routeClickPolyline.setMap) routeClickPolyline.setMap(null);
    routeClickPolyline = null;
  }
}

/** Índice del punto más cercano a (lat, lng) en el path */
function findClosestPointIndex(lat, lng, path) {
  if (!path || path.length === 0) return 0;
  let best = 0;
  let bestD = Infinity;
  path.forEach((p, i) => {
    const plon = p.lon != null ? p.lon : p.lng;
    const d = haversineKm(lat, lng, p.lat, plon);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Punto editable por índice en la ruta: 0 = inicio, length-1 = fin, resto = waypoints o routePath[i] */
function getPointByRouteIndex(i) {
  if (!routePath || routePath.length === 0) return null;
  if (i <= 0) return startPos;
  if (i >= routePath.length - 1) return endPos;
  return waypoints[i - 1] ?? routePath[i] ?? null;
}

function setRouteClickPolyline(path) {
  clearRouteClickPolyline();
  if (!mapInstance || !window.google?.maps || !path || path.length < 2) return;
  const pathLatLng = path.map(p => ({ lat: p.lat, lng: p.lon != null ? p.lon : p.lng }));
  routeClickPolyline = new window.google.maps.Polyline({
    path: pathLatLng,
    strokeOpacity: 0,
    strokeWeight: 18,
    clickable: true,
  });
  routeClickPolyline.setMap(mapInstance);
  routeClickPolyline.addListener('click', (ev) => {
    if (!ev.latLng) return;
    const lat = ev.latLng.lat();
    const lng = ev.latLng.lng();
    const pts = loadedRoutePathPoints.length > 0 ? loadedRoutePathPoints : routePath.map(p => ({ lat: p.lat, lng: p.lon }));
    const idx = findClosestPointIndex(lat, lng, pts);
    openPointEditor(idx);
  });
}

/** Dado un objeto values, devuelve el primer valor numérico cuya clave coincida con los nombres preferidos o con el regex */
function pickNumericFromValues(values, preferredKeys, keyRegex) {
  if (!values || typeof values !== 'object') return null;
  const num = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
  for (const k of preferredKeys) {
    const val = num(values[k]);
    if (val != null) return val;
  }
  for (const k of Object.keys(values)) {
    if (keyRegex.test(k)) {
      const val = num(values[k]);
      if (val != null) return val;
    }
  }
  return null;
}

/** Obtiene los valores a mostrar para un punto (coords + sensores), uniendo point y loadedRoutePathPoints[i].values */
function getPointDisplayData(index) {
  const point = getPointByRouteIndex(index);
  if (!point) return null;
  const v = loadedRoutePathPoints[index]?.values;
  const num = (x) => (x != null && Number.isFinite(Number(x)) ? Number(x) : null);
  return {
    lat: point.lat,
    lon: point.lon != null ? point.lon : point.lng,
    speedKmh: num(point.speedKmh) ?? num(point.speed_kmh) ?? pickNumericFromValues(v, ['speedKmh', 'speed_kmh', 'speed'], /speed/i),
    rpm: num(point.rpm) ?? pickNumericFromValues(v, ['rpm', 'RPM'], /rpm/i),
    altitude: num(point.altitude) ?? num(point.ele) ?? num(point.alt) ?? pickNumericFromValues(v, ['altitude', 'ele', 'alt', 'Altitude'], /alt|ele/i),
  };
}

function openPointEditor(index) {
  editingPointIndex = index;
  const data = getPointDisplayData(index);
  if (!data) return;
  const panel = $('route-creator-point-editor');
  if (!panel) return;
  const latInp = $('route-point-edit-lat');
  const lonInp = $('route-point-edit-lon');
  const speedInp = $('route-point-edit-speed');
  const rpmInp = $('route-point-edit-rpm');
  const altInp = $('route-point-edit-alt');
  const str = (x) => (x != null && x !== '' ? String(x) : '');
  if (latInp) latInp.value = str(data.lat);
  if (lonInp) lonInp.value = str(data.lon);
  if (speedInp) speedInp.value = str(data.speedKmh);
  if (rpmInp) rpmInp.value = str(data.rpm);
  if (altInp) altInp.value = str(data.altitude);
  const title = panel.querySelector('.route-creator-point-editor-title');
  if (title) title.textContent = 'Punto en la ruta #' + (index + 1);
  panel.style.display = 'block';
}

function applyPointEdit() {
  if (editingPointIndex == null) return;
  const point = getPointByRouteIndex(editingPointIndex);
  if (!point) return;
  const latInp = $('route-point-edit-lat');
  const lonInp = $('route-point-edit-lon');
  const speedInp = $('route-point-edit-speed');
  const rpmInp = $('route-point-edit-rpm');
  const altInp = $('route-point-edit-alt');
  const lat = latInp && latInp.value.trim() !== '' ? parseFloat(latInp.value) : null;
  const lon = lonInp && lonInp.value.trim() !== '' ? parseFloat(lonInp.value) : null;
  if (lat != null && Number.isFinite(lat)) point.lat = lat;
  if (lon != null && Number.isFinite(lon)) { point.lon = lon; point.lng = lon; }
  point.speedKmh = speedInp && speedInp.value.trim() !== '' && Number.isFinite(parseFloat(speedInp.value)) ? parseFloat(speedInp.value) : undefined;
  point.rpm = rpmInp && rpmInp.value.trim() !== '' && Number.isFinite(parseFloat(rpmInp.value)) ? parseFloat(rpmInp.value) : undefined;
  point.altitude = altInp && altInp.value.trim() !== '' && Number.isFinite(parseFloat(altInp.value)) ? parseFloat(altInp.value) : undefined;
  if (routePath[editingPointIndex]) {
    routePath[editingPointIndex] = { ...routePath[editingPointIndex], lat: point.lat, lon: point.lon != null ? point.lon : point.lng };
    if (point.speedKmh != null) routePath[editingPointIndex].speedKmh = point.speedKmh;
    if (point.rpm != null) routePath[editingPointIndex].rpm = point.rpm;
    if (point.altitude != null) routePath[editingPointIndex].altitude = point.altitude;
  }
  if (loadedRoutePathPoints[editingPointIndex]) {
    loadedRoutePathPoints[editingPointIndex].lat = point.lat;
    loadedRoutePathPoints[editingPointIndex].lng = point.lon != null ? point.lon : point.lng;
    const vals = loadedRoutePathPoints[editingPointIndex].values || {};
    loadedRoutePathPoints[editingPointIndex].values = vals;
    if (point.speedKmh != null) vals.speedKmh = point.speedKmh;
    if (point.rpm != null) vals.rpm = point.rpm;
    if (point.altitude != null) vals.altitude = point.altitude;
    // Actualizar también las claves que usa el mapa de calor (ej. "GPS Speed(km/h)")
    loadedRouteSensorKeys.forEach(k => {
      if (/speed/i.test(k) && point.speedKmh != null) vals[k] = point.speedKmh;
      else if (/rpm/i.test(k) && point.rpm != null) vals[k] = point.rpm;
      else if (/alt|ele/i.test(k) && point.altitude != null) vals[k] = point.altitude;
    });
  }
  const panel = $('route-creator-point-editor');
  if (panel) panel.style.display = 'none';
  editingPointIndex = null;
  updateRoutePathPolyline();
  const heatSelect = $('route-creator-heat-sensor');
  if (heatSelect && heatSelect.value) drawRouteHeatMap(heatSelect.value);
  renderPointsList();
}

function getHeatMinMax(pathPoints, sensorKey) {
  if (!pathPoints.length || !sensorKey) return { min: null, max: null };
  let min = Infinity, max = -Infinity;
  pathPoints.forEach(p => {
    const v = p.values && p.values[sensorKey];
    if (v != null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); }
  });
  return { min: min === Infinity ? null : min, max: max === -Infinity ? null : max };
}

function drawRouteHeatMap(sensorKey) {
  if (!mapInstance || !window.google?.maps) return;
  clearRouteHeatPolylines();
  if (routePathPolyline) {
    routePathPolyline.setMap(null);
    routePathPolyline = null;
  }
  const path = (loadedRoutePathPoints.length > 0 ? loadedRoutePathPoints : routePath).map(p => ({ lat: p.lat, lng: p.lng }));
  if (path.length < 2) return;
  const pathPoints = loadedRoutePathPoints.length > 0 ? loadedRoutePathPoints : routePath.map(p => ({ lat: p.lat, lng: p.lon, values: {} }));
  const hasValues = pathPoints.length > 0 && pathPoints[0].values && Object.keys(pathPoints[0].values).length > 0;
  if (!sensorKey || !hasValues) {
    routePathPolyline = new window.google.maps.Polyline({
      path,
      strokeColor: '#00d4aa',
      strokeOpacity: 0.9,
      strokeWeight: 5,
    });
    routePathPolyline.setMap(mapInstance);
    const legendEl = $('route-creator-heat-legend');
    if (legendEl) legendEl.textContent = '';
    setRouteClickPolyline(path);
    return;
  }
  const values = pathPoints.map(p => (p.values && p.values[sensorKey] != null) ? p.values[sensorKey] : null);
  let min = Infinity, max = -Infinity;
  values.forEach(v => { if (v != null && Number.isFinite(v)) { min = Math.min(min, v); max = Math.max(max, v); } });
  if (min === Infinity) {
    routePathPolyline = new window.google.maps.Polyline({ path, strokeColor: '#00d4aa', strokeOpacity: 0.9, strokeWeight: 5 });
    routePathPolyline.setMap(mapInstance);
    setRouteClickPolyline(path);
    return;
  }
  const range = max - min || 1;
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
    seg.setMap(mapInstance);
    routeHeatPolylines.push(seg);
  }
  const legendEl = $('route-creator-heat-legend');
  if (legendEl) {
    const mn = typeof min === 'number' && min % 1 !== 0 ? min.toFixed(1) : min;
    const mx = typeof max === 'number' && max % 1 !== 0 ? max.toFixed(1) : max;
    legendEl.textContent = sensorKey + ': ' + mn + ' — ' + mx;
  }
  setRouteClickPolyline(path);
}

function getMapEl() {
  return $('route-creator-map');
}

function showNoKeyMessage() {
  const mapEl = getMapEl();
  const noKey = $('route-creator-map-no-key');
  if (mapEl && noKey) {
    mapEl.style.display = 'none';
    noKey.style.display = 'block';
  }
}

function hideNoKeyMessage() {
  const noKey = $('route-creator-map-no-key');
  const mapEl = getMapEl();
  if (noKey) noKey.style.display = 'none';
  if (mapEl) mapEl.style.display = 'block';
}

function loadGoogleMapsScript(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve();
  if (mapLoadPromise) return mapLoadPromise;
  mapLoadPromise = new Promise((resolve, reject) => {
    const cbName = 'initRouteCreatorMapCallback';
    window[cbName] = () => {
      window[cbName] = null;
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${cbName}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      mapLoadPromise = null;
      reject(new Error('Error al cargar Google Maps'));
    };
    document.head.appendChild(script);
  });
  return mapLoadPromise;
}

let markerLibraryLoaded = false;

async function ensureMarkerLibrary() {
  const g = window.google;
  if (!g?.maps) return false;
  if (g.maps.marker?.AdvancedMarkerElement) return true;
  try {
    await g.maps.importLibrary('marker');
    markerLibraryLoaded = !!(g.maps.marker && g.maps.marker.AdvancedMarkerElement);
    return markerLibraryLoaded;
  } catch (_) {
    return false;
  }
}

function getMarkerPosition(m) {
  if (!m) return null;
  if (typeof m.getPosition === 'function') {
    const p = m.getPosition();
    return p ? { lat: p.lat(), lng: p.lng() } : null;
  }
  const p = m.position;
  if (p && (typeof p.lat === 'function' ? p.lat() : p.lat) != null)
    return { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng };
  return null;
}

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll('.route-mode-btn').forEach(btn => {
    btn.classList.toggle('active', (btn.dataset.mode || '') === mode);
  });
}

function createMarker(position, label, color, draggable) {
  if (!mapInstance || !window.google.maps) return null;
  const g = window.google.maps;
  const pos = { lat: position.lat, lng: position.lng };
  if (window.google.maps.marker?.AdvancedMarkerElement && markerLibraryLoaded) {
    const content = document.createElement('div');
    content.style.cssText = 'width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:' + (color || '#666') + ';color:#fff;font-size:12px;font-weight:bold;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
    content.textContent = label || '';
    const m = new window.google.maps.marker.AdvancedMarkerElement({
      map: mapInstance,
      position: pos,
      gmpDraggable: !!draggable,
      title: label || 'Marcador',
      content,
    });
    return m;
  }
  const m = new g.Marker({
    position: pos,
    map: mapInstance,
    draggable: !!draggable,
    label: label ? { text: label, color: 'white' } : null,
    icon: color ? {
      path: g.SymbolPath.CIRCLE,
      scale: 12,
      fillColor: color,
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 2,
    } : null,
  });
  return m;
}

function removeMarker(m) {
  if (!m) return;
  if (typeof m.setMap === 'function') m.setMap(null);
  else if (m.map !== undefined) m.map = null;
}

function onMapClick(e) {
  const lat = e.latLng.lat();
  const lng = e.latLng.lng();
  const pos = { lat, lng };
  if (currentMode === 'start') {
    removeMarker(startMarker);
    startPos = startPos ? { ...startPos, lat: pos.lat, lng: pos.lng } : pos;
    startMarker = createMarker(startPos, 'A', '#4caf50', true);
    if (startMarker) startMarker.addListener('dragend', () => {
      const p = getMarkerPosition(startMarker);
      if (p && startPos) { startPos.lat = p.lat; startPos.lng = p.lng; }
      renderPointsList();
      requestRoute();
    });
  } else if (currentMode === 'end') {
    removeMarker(endMarker);
    endPos = endPos ? { ...endPos, lat: pos.lat, lng: pos.lng } : pos;
    endMarker = createMarker(endPos, 'B', '#f44336', true);
    if (endMarker) endMarker.addListener('dragend', () => {
      const p = getMarkerPosition(endMarker);
      if (p && endPos) { endPos.lat = p.lat; endPos.lng = p.lng; }
      renderPointsList();
      requestRoute();
    });
  } else if (currentMode === 'waypoint') {
    waypoints.push(pos);
    const idx = waypoints.length - 1;
    const m = createMarker(pos, String(idx + 1), '#ff9800', true);
    if (m) {
      m.addListener('dragend', () => {
        const p = getMarkerPosition(m);
        if (p && waypoints[idx]) { waypoints[idx].lat = p.lat; waypoints[idx].lng = p.lng; }
        renderPointsList();
        requestRoute();
      });
      waypointMarkers.push(m);
    }
  }
  renderPointsList();
  requestRoute();
}

function removeWaypoint(index) {
  if (index < 0 || index >= waypoints.length) return;
  removeMarker(waypointMarkers[index]);
  waypoints.splice(index, 1);
  waypointMarkers.splice(index, 1);
  for (let i = 0; i < waypointMarkers.length; i++) {
    const w = waypointMarkers[i];
    if (w?.content?.textContent !== undefined) w.content.textContent = String(i + 1);
    else if (w?.setLabel) w.setLabel({ text: String(i + 1), color: 'white' });
  }
  renderPointsList();
  requestRoute();
}

function getPointByKey(key) {
  if (key === 'start') return startPos;
  if (key === 'end') return endPos;
  const m = key.match(/^waypoint-(\d+)$/);
  if (m) return waypoints[parseInt(m[1], 10)];
  return null;
}

function setPointSensor(key, data) {
  const point = getPointByKey(key);
  if (!point) return;
  if (data.speedKmh != null) point.speedKmh = data.speedKmh === '' ? undefined : Number(data.speedKmh);
  if (data.rpm != null) point.rpm = data.rpm === '' ? undefined : Number(data.rpm);
  if (data.altitude != null) point.altitude = data.altitude === '' ? undefined : Number(data.altitude);
}

function renderPointsList() {
  const ul = $('route-creator-points');
  const hint = $('route-creator-points-hint');
  if (!ul) return;
  const items = [];
  if (startPos) {
    items.push({ type: 'start', label: 'Inicio', pos: startPos, canDelete: false, pointKey: 'start' });
  }
  waypoints.forEach((wp, i) => {
    items.push({ type: 'waypoint', index: i, label: `Parada ${i + 1}`, pos: wp, canDelete: true, pointKey: 'waypoint-' + i });
  });
  if (endPos) {
    items.push({ type: 'end', label: 'Fin', pos: endPos, canDelete: false, pointKey: 'end' });
  }
  ul.innerHTML = items.map(item => {
    const key = item.pointKey;
    const speed = item.pos.speedKmh != null ? String(item.pos.speedKmh) : '';
    const rpm = item.pos.rpm != null ? String(item.pos.rpm) : '';
    const alt = item.pos.altitude != null ? String(item.pos.altitude) : '';
    return '<li class="point-row">' +
      '<div class="point-row-main">' +
      '<span class="point-label ' + item.type + '">' + escapeHtml(item.label) + '</span>' +
      '<span class="point-coords">' + item.pos.lat.toFixed(5) + ', ' + item.pos.lng.toFixed(5) + '</span>' +
      '<button type="button" class="btn btn-ghost point-sensors-btn" data-point-key="' + escapeHtml(key) + '" title="Editar sensores">Sensores</button>' +
      '<button type="button" class="btn btn-ghost point-delete ' + (item.canDelete ? '' : 'disabled') + '" data-index="' + (item.type === 'waypoint' ? item.index : -1) + '" title="Eliminar">×</button>' +
      '</div>' +
      '<div class="point-sensor-editor" id="point-sensor-' + escapeHtml(key) + '" data-point-key="' + escapeHtml(key) + '" style="display:none;">' +
      '<label>Velocidad (km/h) <input type="number" class="point-sensor-input" data-field="speedKmh" placeholder="—" step="0.1" min="0" value="' + escapeHtml(speed) + '"></label>' +
      '<label>RPM <input type="number" class="point-sensor-input" data-field="rpm" placeholder="—" min="0" value="' + escapeHtml(rpm) + '"></label>' +
      '<label>Altitud (m) <input type="number" class="point-sensor-input" data-field="altitude" placeholder="—" step="0.1" value="' + escapeHtml(alt) + '"></label>' +
      '<button type="button" class="btn btn-ghost point-sensor-apply" data-point-key="' + escapeHtml(key) + '">Aplicar</button>' +
      '</div></li>';
  }).join('');
  ul.querySelectorAll('.point-delete:not(.disabled)').forEach(btn => {
    const idx = parseInt(btn.dataset.index, 10);
    if (idx >= 0) btn.onclick = () => removeWaypoint(idx);
  });
  ul.querySelectorAll('.point-sensors-btn').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.pointKey;
      const editor = document.getElementById('point-sensor-' + key);
      if (editor) editor.style.display = editor.style.display === 'none' ? 'block' : 'none';
    };
  });
  ul.querySelectorAll('.point-sensor-apply').forEach(btn => {
    btn.onclick = () => {
      const key = btn.dataset.pointKey;
      const editor = document.getElementById('point-sensor-' + key);
      if (!editor) return;
      const data = {};
      editor.querySelectorAll('.point-sensor-input').forEach(inp => {
        data[inp.dataset.field] = inp.value;
      });
      setPointSensor(key, data);
      editor.style.display = 'none';
    };
  });
  if (hint) hint.style.display = items.length >= 2 ? 'none' : 'block';
}

const MAX_WAYPOINTS_DIRECTIONS = 23; // Límite de la API de Google Directions (origin + 23 waypoints + destination)

function requestRoute() {
  if (!directionsService || !directionsRenderer || !startPos || !endPos) {
    if (directionsRenderer) directionsRenderer.setMap(null);
    routePath = [];
    return;
  }
  if (waypoints.length > MAX_WAYPOINTS_DIRECTIONS) {
    alert('Rehacer solo aplica a rutas con pocas paradas (máximo ' + MAX_WAYPOINTS_DIRECTIONS + '). Esta ruta tiene ' + waypoints.length + ' paradas. Reduce paradas o crea una ruta nueva con Inicio, Fin y hasta ' + MAX_WAYPOINTS_DIRECTIONS + ' paradas.');
    return;
  }
  const origin = new window.google.maps.LatLng(startPos.lat, startPos.lng);
  const destination = new window.google.maps.LatLng(endPos.lat, endPos.lng);
  const waypointsRequest = waypoints.map(w => ({
    location: new window.google.maps.LatLng(w.lat, w.lng),
    stopover: true,
  }));
  directionsService.route(
    {
      origin,
      destination,
      waypoints: waypointsRequest,
      travelMode: window.google.maps.TravelMode.DRIVING,
    },
    (result, status) => {
      if (status === window.google.maps.DirectionsStatus.OK && result.routes && result.routes[0]) {
        if (routePathPolyline) {
          routePathPolyline.setMap(null);
          routePathPolyline = null;
        }
        directionsRenderer.setMap(mapInstance);
        directionsRenderer.setDirections(result);
        const route = result.routes[0];
        if (route.overview_path && route.overview_path.length) {
          routePath = route.overview_path.map(ll => ({ lat: ll.lat(), lon: ll.lng() }));
        } else {
          const path = [];
          (route.legs || []).forEach(leg => {
            if (leg.start_location) path.push({ lat: leg.start_location.lat(), lon: leg.start_location.lng() });
            (leg.steps || []).forEach(step => {
              if (step.end_location) path.push({ lat: step.end_location.lat(), lon: step.end_location.lng() });
            });
          });
          routePath = path.length > 0 ? path : [startPos, endPos].map(p => ({ lat: p.lat, lon: p.lng }));
        }
      } else {
        directionsRenderer.setMap(null);
        routePath = [startPos, ...waypoints, endPos].map(p => ({ lat: p.lat, lon: p.lng }));
        if (status !== window.google.maps.DirectionsStatus.OK) {
          const msg = (status && String(status)) || 'Error desconocido';
          alert('No se pudo regenerar la ruta por carretera: ' + msg + '. Comprueba la API de Google Maps (Directions) y facturación.');
        }
      }
      updateRoutePathPolyline();
    }
  );
}

function updateRoutePathPolyline() {
  clearRouteHeatPolylines();
  if (routePathPolyline) {
    routePathPolyline.setMap(null);
    routePathPolyline = null;
  }
  if (directionsRenderer && directionsRenderer.getMap()) return;
  if (!mapInstance || !window.google?.maps || routePath.length < 2) return;
  const heatSelect = $('route-creator-heat-sensor');
  if (heatSelect && heatSelect.value && loadedRoutePathPoints.length > 0) {
    for (let i = 0; i < Math.min(loadedRoutePathPoints.length, routePath.length); i++) {
      loadedRoutePathPoints[i].lat = routePath[i].lat;
      loadedRoutePathPoints[i].lng = routePath[i].lon;
    }
    drawRouteHeatMap(heatSelect.value);
    return;
  }
  routePathPolyline = new window.google.maps.Polyline({
    path: routePath.map(p => ({ lat: p.lat, lng: p.lon })),
    strokeColor: '#00d4aa',
    strokeWeight: 5,
    strokeOpacity: 0.9,
  });
  routePathPolyline.setMap(mapInstance);
  setRouteClickPolyline(routePath);
}

function clearAll() {
  startPos = null;
  endPos = null;
  waypoints = [];
  routePath = [];
  editingRouteId = null;
  loadedRoutePathPoints = [];
  loadedRouteSensorKeys = [];
  removeMarker(startMarker);
  removeMarker(endMarker);
  waypointMarkers.forEach(removeMarker);
  waypointMarkers = [];
  startMarker = null;
  endMarker = null;
  clearRouteHeatPolylines();
  clearRouteClickPolyline();
  editingPointIndex = null;
  const pointEditorPanel = $('route-creator-point-editor');
  if (pointEditorPanel) pointEditorPanel.style.display = 'none';
  const heatWrap = $('route-creator-heat-wrap');
  const heatSelect = $('route-creator-heat-sensor');
  if (heatWrap) heatWrap.style.display = 'none';
  if (heatSelect) heatSelect.value = '';
  if ($('route-creator-heat-legend')) $('route-creator-heat-legend').textContent = '';
  if (directionsRenderer) directionsRenderer.setMap(null);
  updateRoutePathPolyline();
  renderPointsList();
}

function escapeHtml(s) {
  if (s == null) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

/** Distancia aproximada en km entre dos puntos (Haversine) */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getRouteStats(r) {
  const pts = r.waypoints || [];
  let distanceKm = 0;
  let hasSpeed = false;
  let hasAltitude = false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (typeof a.lat === 'number' && typeof a.lon === 'number' && typeof b.lat === 'number' && typeof b.lon === 'number') {
      distanceKm += haversineKm(a.lat, a.lon, b.lat, b.lon);
    }
    if (a.speedKmh != null && Number.isFinite(Number(a.speedKmh))) hasSpeed = true;
    if (a.altitude != null || a.ele != null || a.alt != null) hasAltitude = true;
  }
  if (pts.length > 0) {
    const last = pts[pts.length - 1];
    if (last.speedKmh != null && Number.isFinite(Number(last.speedKmh))) hasSpeed = true;
    if (last.altitude != null || last.ele != null || last.alt != null) hasAltitude = true;
  }
  return { distanceKm, hasSpeed, hasAltitude, pointCount: pts.length };
}

function formatRouteDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '—';
  }
}

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Nombre (A-Z)', fn: (a, b) => (a.name || '').localeCompare(b.name || '') },
  { value: 'name-desc', label: 'Nombre (Z-A)', fn: (a, b) => (b.name || '').localeCompare(a.name || '') },
  { value: 'date-desc', label: 'Fecha (más reciente)', fn: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0) },
  { value: 'date-asc', label: 'Fecha (más antigua)', fn: (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0) },
  { value: 'distance-desc', label: 'Distancia (mayor)', fn: (a, b) => (b._stats?.distanceKm ?? 0) - (a._stats?.distanceKm ?? 0) },
  { value: 'distance-asc', label: 'Distancia (menor)', fn: (a, b) => (a._stats?.distanceKm ?? 0) - (b._stats?.distanceKm ?? 0) },
  { value: 'points-desc', label: 'Más puntos', fn: (a, b) => (b._stats?.pointCount ?? 0) - (a._stats?.pointCount ?? 0) },
  { value: 'points-asc', label: 'Menos puntos', fn: (a, b) => (a._stats?.pointCount ?? 0) - (b._stats?.pointCount ?? 0) },
  { value: 'speed', label: 'Con velocidad', fn: (a, b) => (b._stats?.hasSpeed ? 1 : 0) - (a._stats?.hasSpeed ? 1 : 0) },
  { value: 'altitude', label: 'Con altimetría', fn: (a, b) => (b._stats?.hasAltitude ? 1 : 0) - (a._stats?.hasAltitude ? 1 : 0) },
];

function sortRoutes(list, sortValue) {
  const opt = SORT_OPTIONS.find(o => o.value === sortValue) || SORT_OPTIONS[2];
  return [...list].sort(opt.fn);
}

let savedRoutesList = [];
let savedRoutesSort = 'date-desc';

function initSavedRoutesSort() {
  const sortSelect = $('route-creator-sort');
  if (!sortSelect) return;
  if (sortSelect.options.length === 0) {
    SORT_OPTIONS.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sortSelect.appendChild(opt);
    });
    sortSelect.value = 'date-desc';
  }
  sortSelect.replaceWith(sortSelect.cloneNode(true)); // remove old listeners
  const newSelect = $('route-creator-sort');
  if (newSelect) {
    newSelect.addEventListener('change', () => {
      savedRoutesSort = newSelect.value;
      renderSavedRoutesList(savedRoutesList, savedRoutesSort);
    });
  }
}

function renderSavedRoutesList(list, sortValue) {
  const ul = $('route-creator-saved-list');
  const sortSelect = $('route-creator-sort');
  if (!ul) return;
  const sorted = sortRoutes(list, sortValue);
  const iconEdit = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-pencil"/></svg>';
  const iconGps = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-gps-pin"/></svg>';
  const iconTrash = '<svg class="icon icon--sm" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-trash"/></svg>';
  ul.innerHTML = sorted.length === 0
    ? '<li class="kv" style="color:var(--text-muted);font-size:0.9rem;">No hay rutas guardadas</li>'
    : sorted.map(r => {
        const name = (r.name != null && String(r.name).trim()) ? String(r.name).trim() : 'Sin nombre';
        const id = (r.id != null) ? String(r.id) : '';
        const stats = r._stats || getRouteStats(r);
        const dateStr = formatRouteDate(r.createdAt);
        const distStr = stats.distanceKm != null && stats.distanceKm > 0 ? stats.distanceKm.toFixed(1) + ' km' : '';
        const badges = [];
        if (stats.hasSpeed) badges.push('<span class="route-saved-badge route-saved-badge--speed" title="Tiene velocidad por punto">Velocidad</span>');
        if (stats.hasAltitude) badges.push('<span class="route-saved-badge route-saved-badge--alt" title="Tiene altimetría">Altimetría</span>');
        return '<li class="route-saved-panel">' +
          '<h4 class="route-saved-panel-title route-saved-panel-title-link" data-id="' + escapeHtml(id) + '" title="Clic para cargar en el mapa">' + escapeHtml(name) + '</h4>' +
          '<div class="route-saved-panel-meta">' +
          '<span class="route-saved-date">' + escapeHtml(dateStr) + '</span>' +
          (distStr ? '<span class="route-saved-distance">' + escapeHtml(distStr) + '</span>' : '') +
          (badges.length ? '<span class="route-saved-badges">' + badges.join('') + '</span>' : '') +
          '</div>' +
          '<div class="route-saved-panel-actions">' +
          '<button type="button" class="btn btn-ghost btn-edit-route" data-id="' + escapeHtml(id) + '" title="Editar en el mapa">' + iconEdit + 'Editar</button>' +
          '<button type="button" class="btn btn-ghost btn-load-route" data-id="' + escapeHtml(id) + '" title="Enviar al simulador GPS">' + iconGps + 'GPS</button>' +
          '<button type="button" class="btn btn-ghost btn-delete-route" data-id="' + escapeHtml(id) + '" title="Eliminar">' + iconTrash + 'Eliminar</button>' +
          '</div></li>';
      }).join('');
  ul.querySelectorAll('.route-saved-panel-title-link').forEach(el => {
    const id = el.getAttribute('data-id');
    el.onclick = () => { if (id) loadRouteForEdit(id); };
  });
  ul.querySelectorAll('.btn-edit-route').forEach(btn => {
    btn.onclick = () => loadRouteForEdit(btn.dataset.id);
  });
  ul.querySelectorAll('.btn-load-route').forEach(btn => {
    btn.onclick = () => loadRouteIntoSimulator(btn.dataset.id);
  });
  ul.querySelectorAll('.btn-delete-route').forEach(btn => {
    btn.onclick = () => deleteRoute(btn.dataset.id, btn);
  });
  if (sortSelect) sortSelect.disabled = sorted.length === 0;
}

function setSavedRoutesListLoading(loading) {
  const ul = $('route-creator-saved-list');
  if (!ul) return;
  if (loading) {
    ul.innerHTML = '<li class="route-saved-list-loading"><span class="route-saved-list-loading-spinner"></span>Cargando rutas…</li>';
  }
}

async function loadSavedRoutes() {
  const ul = $('route-creator-saved-list');
  if (!ul) return;
  setSavedRoutesListLoading(true);
  try {
    const list = await api('/saved-routes', { timeout: 3000 });
    savedRoutesList = list.map(r => ({ ...r, _stats: getRouteStats(r) }));
    savedRoutesSort = ($('route-creator-sort') && $('route-creator-sort').value) || 'date-desc';
    renderSavedRoutesList(savedRoutesList, savedRoutesSort);
  } catch (_) {
    ul.innerHTML = '<li class="kv" style="color:var(--warn);">Error al cargar la lista</li>';
  }
}

async function loadRouteForEdit(routeId) {
  if (!mapInstance || !window.google?.maps) {
    alert('Carga el mapa primero.');
    return;
  }
  try {
    const route = await api('/saved-routes/' + routeId, { timeout: 3000 });
    const pts = route.waypoints || [];
    if (pts.length < 2) {
      alert('La ruta no tiene suficientes puntos.');
      return;
    }
    clearAll();
    editingRouteId = routeId;
    const toPoint = (p) => ({ ...p, lat: p.lat, lng: p.lon != null ? p.lon : p.lng });
    const first = toPoint(pts[0]);
    const last = toPoint(pts[pts.length - 1]);
    startPos = first;
    endPos = last;
    waypoints = pts.length > 2 ? pts.slice(1, -1).map(toPoint) : [];
    routePath = pts.map(p => ({ lat: p.lat, lon: p.lon != null ? p.lon : p.lng }));
    startMarker = createMarker(startPos, 'A', '#4caf50', true);
    endMarker = createMarker(endPos, 'B', '#f44336', true);
    if (startMarker) {
      startMarker.addListener('dragend', () => {
        const p = getMarkerPosition(startMarker);
        if (p && startPos) { startPos.lat = p.lat; startPos.lng = p.lng; }
        if (routePath.length > 0) routePath[0] = { ...routePath[0], lat: p.lat, lon: p.lng };
        updateRoutePathPolyline();
        renderPointsList();
      });
    }
    if (endMarker) {
      endMarker.addListener('dragend', () => {
        const p = getMarkerPosition(endMarker);
        if (p && endPos) { endPos.lat = p.lat; endPos.lng = p.lng; }
        if (routePath.length > 0) routePath[routePath.length - 1] = { ...routePath[routePath.length - 1], lat: p.lat, lon: p.lng };
        updateRoutePathPolyline();
        renderPointsList();
      });
    }
    // No crear marcadores por cada waypoint al cargar (solo inicio y fin) para no saturar el mapa
    const nameEl = $('route-creator-name');
    if (nameEl) nameEl.value = route.name || '';
    loadedRoutePathPoints = buildPathPointsWithValues(pts);
    loadedRouteSensorKeys = getSensorKeysFromWaypoints(pts);
    const heatWrap = $('route-creator-heat-wrap');
    const heatSelect = $('route-creator-heat-sensor');
    const heatLegend = $('route-creator-heat-legend');
    if (heatWrap && heatSelect) {
      if (loadedRouteSensorKeys.length > 0) {
        heatWrap.style.display = 'flex';
        heatSelect.innerHTML = '';
        const opt0 = document.createElement('option');
        opt0.value = '';
        opt0.textContent = 'Ninguno (línea fija)';
        heatSelect.appendChild(opt0);
        loadedRouteSensorKeys.forEach(k => {
          const opt = document.createElement('option');
          opt.value = k;
          opt.textContent = k;
          heatSelect.appendChild(opt);
        });
        heatSelect.onchange = () => {
          drawRouteHeatMap(heatSelect.value || null);
        };
        if (heatLegend) heatLegend.textContent = '';
        updateRoutePathPolyline();
      } else {
        heatWrap.style.display = 'none';
        heatSelect.innerHTML = '';
        heatSelect.onchange = null;
        if (heatLegend) heatLegend.textContent = '';
        updateRoutePathPolyline();
      }
    } else {
      updateRoutePathPolyline();
    }
    renderPointsList();
    const bounds = new window.google.maps.LatLngBounds();
    pts.forEach(p => bounds.extend({ lat: p.lat, lng: p.lon }));
    mapInstance.fitBounds(bounds, { top: 60, bottom: 60, left: 40, right: 40 });
  } catch (e) {
    alert('Error al cargar la ruta: ' + (e.message || ''));
  }
}

async function loadRouteIntoSimulator(routeId) {
  try {
    const route = await api('/saved-routes/' + routeId, { timeout: 3000 });
    const pts = route.waypoints || [];
    if (pts.length < 2) {
      alert('La ruta no tiene suficientes puntos.');
      return;
    }
    const first = pts[0];
    const params = new URLSearchParams({
      lat: first.lat,
      lon: first.lon,
      routeOn: '1',
      routeWaypoints: JSON.stringify(pts),
    });
    const r = await fetch('/api/gps/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });
    if (r.ok) {
      alert(`Ruta "${route.name}" cargada. Ve a Emulador GPS NEO, sección Posición y envío por serial, y pulsa Aplicar (y Iniciar envío si el puerto está abierto).`);
    } else {
      const data = await r.json().catch(() => ({}));
      alert(data.error || 'Error al cargar la ruta');
    }
  } catch (e) {
    alert('Error: ' + (e.message || 'no se pudo cargar la ruta'));
  }
}

function setRoutePanelDeleting(panel, deleting) {
  if (!panel) return;
  const actions = panel.querySelector('.route-saved-panel-actions');
  if (!actions) return;
  if (deleting) {
    panel.classList.add('route-saved-panel-deleting');
    actions.innerHTML = '<span class="route-saved-deleting"><span class="route-saved-deleting-spinner"></span>Eliminando…</span>';
  } else {
    panel.classList.remove('route-saved-panel-deleting');
    renderSavedRoutesList(savedRoutesList, savedRoutesSort);
  }
}

async function deleteRoute(routeId, deleteButton) {
  if (!confirm('¿Eliminar esta ruta?')) return;
  const panel = deleteButton ? deleteButton.closest('.route-saved-panel') : null;
  setRoutePanelDeleting(panel, true);
  try {
    const r = await fetch('/api/saved-routes/' + routeId, { method: 'DELETE' });
    if (r.ok) {
      const idStr = String(routeId);
      savedRoutesList = savedRoutesList.filter(item => String(item.id) !== idStr);
      savedRoutesSort = ($('route-creator-sort') && $('route-creator-sort').value) || 'date-desc';
      renderSavedRoutesList(savedRoutesList, savedRoutesSort);
      if (editingRouteId === routeId) {
        editingRouteId = null;
        clearAll();
      }
    } else {
      const err = await r.json().catch(() => ({}));
      setRoutePanelDeleting(panel, false);
      alert(err.error || 'No se pudo eliminar la ruta.');
    }
  } catch (e) {
    setRoutePanelDeleting(panel, false);
    alert('Error: ' + (e.message || 'no se pudo eliminar'));
  }
}

export async function initRouteCreator() {
  const mapEl = getMapEl();
  if (!mapEl) return;
  initSavedRoutesSort();
  try {
    const config = await api('/config', { timeout: 3000 });
    const key = (config.googleMapsApiKey || '').trim();
    if (!key) {
      showNoKeyMessage();
      loadSavedRoutes();
      return;
    }
    hideNoKeyMessage();
    await loadGoogleMapsScript(key);
    const mapId = (config.googleMapsMapId || '').trim();
    if (mapId) {
      console.log('[Creador de rutas] Map ID válido — Marcadores avanzados activos');
    } else {
      console.log('[Creador de rutas] Sin Map ID — Marcadores clásicos');
    }
    const g = window.google;
    if (!mapInstance) {
      const mapOptions = {
        center: DEFAULT_CENTER,
        zoom: 12,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
      };
      if (mapId) mapOptions.mapId = mapId;
      mapInstance = new g.maps.Map(mapEl, mapOptions);
    }
    if (mapId) {
      await ensureMarkerLibrary();
    } else {
      markerLibraryLoaded = false;
    }
    if (mapInstance && !directionsService) {
      directionsService = new g.maps.DirectionsService();
      directionsRenderer = new g.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: { strokeColor: '#00d4aa', strokeWeight: 5 },
      });
      mapInstance.addListener('click', onMapClick);
      setMode('start');
      document.querySelectorAll('.route-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setMode(btn.dataset.mode || 'start'));
      });
      const requestBtn = $('route-creator-request');
      if (requestBtn) requestBtn.onclick = requestRoute;
    }
    loadSavedRoutes();
  } catch (_) {
    showNoKeyMessage();
    loadSavedRoutes();
  }
}

export function bindRouteCreator() {
  const clearBtn = $('route-creator-clear');
  const redoBtn = $('route-creator-redo');
  const saveBtn = $('route-creator-save');
  if (clearBtn) clearBtn.onclick = clearAll;
  if (redoBtn) redoBtn.onclick = () => requestRoute();
  const pointApplyBtn = $('route-point-edit-apply');
  const pointCloseBtn = $('route-point-edit-close');
  if (pointApplyBtn) pointApplyBtn.onclick = applyPointEdit;
  if (pointCloseBtn) pointCloseBtn.onclick = () => {
    const panel = $('route-creator-point-editor');
    if (panel) panel.style.display = 'none';
    editingPointIndex = null;
  };
  if (saveBtn) saveBtn.onclick = async () => {
    const nameEl = $('route-creator-name');
    const name = (nameEl && nameEl.value && nameEl.value.trim()) || 'Ruta ' + new Date().toLocaleDateString();
    const pointsWithSensors = [startPos, ...waypoints, endPos].filter(Boolean);
    const toSave = pointsWithSensors.map(p => {
      const { lat, lng, lon, ...rest } = p;
      const out = { lat, lon: lng != null ? lng : lon };
      Object.keys(rest).forEach(k => { if (rest[k] !== undefined && rest[k] !== '') out[k] = rest[k]; });
      return out;
    });
    if (toSave.length < 2) {
      alert('Pon al menos Inicio y Fin en el mapa y pulsa "Generar ruta".');
      return;
    }
    try {
      const isUpdate = !!editingRouteId;
      const url = isUpdate ? '/api/saved-routes/' + encodeURIComponent(editingRouteId) : '/api/saved-routes';
      const r = await fetch(url, {
        method: isUpdate ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), waypoints: toSave }),
      });
      const data = await r.json().catch(() => ({}));
      if (data.ok) {
        if (!isUpdate && nameEl) nameEl.value = '';
        editingRouteId = null;
        loadSavedRoutes();
        alert(isUpdate ? 'Ruta actualizada.' : 'Ruta guardada: ' + (data.route && data.route.name));
      } else {
        alert(data.error || 'Error al guardar');
      }
    } catch (e) {
      alert('Error: ' + (e.message || 'no se pudo guardar'));
    }
  };
}
