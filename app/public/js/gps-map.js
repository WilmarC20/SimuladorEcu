/**
 * Mapa de Google Maps para la posición GPS simulada.
 * Usa AdvancedMarkerElement (recomendado desde 2024); fallback a Marker clásico si falla.
 */
import { api, $ } from './api.js';

let mapInstance = null;
let markerInstance = null;
let routePolyline = null;
let useAdvancedMarker = false;
let loadPromise = null;

const DEFAULT_LAT = 4.711;
const DEFAULT_LON = -74.072;

function showNoKeyMessage() {
  const wrap = $('gps-map-wrap');
  const noKey = $('gps-map-no-key');
  const mapEl = $('gps-map');
  if (wrap && noKey && mapEl) {
    mapEl.style.display = 'none';
    noKey.style.display = 'block';
  }
}

function hideNoKeyMessage() {
  const noKey = $('gps-map-no-key');
  const mapEl = $('gps-map');
  if (noKey) noKey.style.display = 'none';
  if (mapEl) mapEl.style.display = 'block';
}

function loadGoogleMapsScript(apiKey) {
  if (window.google && window.google.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const cbName = 'initGpsMapCallback';
    window[cbName] = () => {
      window[cbName] = null;
      resolve();
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=${cbName}&loading=async`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Error al cargar Google Maps'));
    };
    document.head.appendChild(script);
  });
  return loadPromise;
}

function createMarker(center, map) {
  const g = window.google;
  if (!g || !g.maps) return null;
  try {
    if (g.maps.marker && g.maps.marker.AdvancedMarkerElement) {
      const m = new g.maps.marker.AdvancedMarkerElement({
        map,
        position: center,
        title: 'Posición GPS simulada',
      });
      useAdvancedMarker = true;
      return m;
    }
  } catch (_) {}
  try {
    const m = new g.maps.Marker({
      position: center,
      map,
      title: 'Posición GPS simulada',
    });
    useAdvancedMarker = false;
    return m;
  } catch (_) {
    return null;
  }
}

async function ensureMarkerLibrary() {
  const g = window.google;
  if (!g || !g.maps) return false;
  if (g.maps.marker && g.maps.marker.AdvancedMarkerElement) return true;
  try {
    await g.maps.importLibrary('marker');
    return !!(g.maps.marker && g.maps.marker.AdvancedMarkerElement);
  } catch (_) {
    return false;
  }
}

export async function initGpsMapIfNeeded(lat, lon) {
  const mapEl = $('gps-map');
  if (!mapEl) return;
  const latNum = typeof lat === 'number' && !Number.isNaN(lat) ? lat : DEFAULT_LAT;
  const lonNum = typeof lon === 'number' && !Number.isNaN(lon) ? lon : DEFAULT_LON;
  try {
    const config = await api('/config', { timeout: 3000 });
    const key = (config.googleMapsApiKey || '').trim();
    if (!key) {
      showNoKeyMessage();
      return;
    }
    hideNoKeyMessage();
    await loadGoogleMapsScript(key);
    if (mapInstance) {
      updateGpsMapPosition(latNum, lonNum);
      return;
    }
    const center = { lat: latNum, lng: lonNum };
    const mapId = (config.googleMapsMapId || '').trim();
    const hasAdvanced = await ensureMarkerLibrary();
    const baseOptions = {
      center,
      zoom: 14,
      mapTypeControl: true,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControl: true,
      gestureHandling: 'greedy',
      tilt: 0,
      heading: 0,
    };
    // Con mapId no se pueden usar styles (se controlan en Cloud Console).
    if (!mapId) {
      baseOptions.styles = [
        { elementType: 'geometry', stylers: [{ color: '#161922' }] },
        { elementType: 'labels.text.stroke', stylers: [{ color: '#161922' }] },
        { elementType: 'labels.text.fill', stylers: [{ color: '#8b8f9e' }] },
      ];
    } else {
      baseOptions.mapId = mapId;
    }
    try {
      mapInstance = new window.google.maps.Map(mapEl, baseOptions);
      markerInstance = createMarker(center, mapInstance);
      if (!markerInstance && mapInstance) {
        useAdvancedMarker = false;
        markerInstance = new window.google.maps.Marker({
          position: center,
          map: mapInstance,
          title: 'Posición GPS simulada',
        });
      }
    } catch (_) {
      if (!mapInstance) {
        const fallbackOptions = {
          ...baseOptions,
          mapId: undefined,
          styles: [
            { elementType: 'geometry', stylers: [{ color: '#161922' }] },
            { elementType: 'labels.text.stroke', stylers: [{ color: '#161922' }] },
            { elementType: 'labels.text.fill', stylers: [{ color: '#8b8f9e' }] },
          ],
        };
        mapInstance = new window.google.maps.Map(mapEl, fallbackOptions);
        useAdvancedMarker = false;
        markerInstance = new window.google.maps.Marker({
          position: center,
          map: mapInstance,
          title: 'Posición GPS simulada',
        });
      }
    }
    bindMapTiltRotate();
  } catch (_) {
    showNoKeyMessage();
  }
}

function bindMapTiltRotate() {
  const controls = $('gps-map-controls');
  if (!mapInstance || !controls) return;
  controls.style.display = 'flex';
  const view2d = $('gps-map-view-2d');
  const tiltBtn = $('gps-map-tilt');
  const rotateBtn = $('gps-map-rotate-90');
  if (view2d) view2d.onclick = () => {
    if (typeof mapInstance.setTilt === 'function') mapInstance.setTilt(0);
    if (typeof mapInstance.setHeading === 'function') mapInstance.setHeading(0);
  };
  if (tiltBtn) tiltBtn.onclick = () => {
    if (typeof mapInstance.setTilt === 'function') mapInstance.setTilt(45);
  };
  if (rotateBtn) rotateBtn.onclick = () => {
    if (typeof mapInstance.setHeading === 'function') {
      const current = mapInstance.getHeading ? mapInstance.getHeading() : 0;
      mapInstance.setHeading((current + 90) % 360);
    }
  };
}

export function updateGpsMapPosition(lat, lon) {
  if (typeof lat !== 'number' || typeof lon !== 'number' || Number.isNaN(lat) || Number.isNaN(lon)) return;
  if (!mapInstance || !markerInstance) return;
  const pos = { lat, lng: lon };
  if (useAdvancedMarker && 'position' in markerInstance) {
    markerInstance.position = pos;
  } else if (typeof markerInstance.setPosition === 'function') {
    markerInstance.setPosition(pos);
  }
  mapInstance.panTo(pos);
}

/**
 * Dibuja la ruta (polyline) que debe recorrer el marcador. waypoints: [{ lat, lon }, ...] o null para quitar.
 */
export function setGpsMapRoute(waypoints) {
  if (routePolyline) {
    routePolyline.setMap(null);
    routePolyline = null;
  }
  if (!mapInstance || !window.google?.maps) return;
  if (!waypoints || !Array.isArray(waypoints) || waypoints.length < 2) return;
  const path = waypoints.map(w => ({ lat: Number(w.lat), lng: Number(w.lon ?? w.lng) })).filter(p => !Number.isNaN(p.lat) && !Number.isNaN(p.lng));
  if (path.length < 2) return;
  routePolyline = new window.google.maps.Polyline({
    path,
    map: mapInstance,
    strokeColor: '#00d4aa',
    strokeOpacity: 0.85,
    strokeWeight: 4,
  });
}
