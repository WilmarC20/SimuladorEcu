'use strict';

/**
 * Estado del emulador GPS virtual (config, start/stop, ruta, errores).
 * La salida real por UART la hace gps-serial-runner cuando el emulador está iniciado y el puerto abierto.
 */
const state = {
  enabled: false,
  lat: 4.711,
  lon: -74.072,
  alt: 1000,
  sats: 8,
  satsMin: 4,
  satsMax: 12,
  course: 0,
  baud: 9600,
  routeOn: true,
  routeRadius: 1000,
  speedKmh: 30,
  speedMinKmh: 20,
  speedMaxKmh: 50,
  currentSpeedKmh: null, // se actualiza cada tick (aceleración/frenado)
  intervalMs: 1000,
  routeWaypoints: null, // [{ lat, lon }, ...] o null para ruta circular
  routeProgress: null,
  lastTick: null,
  lastSentLat: null,
  lastSentLon: null,
  errorSim: {
    noFix: false,
    badHdop: false,
    jitterMeters: 0,
    dropPercent: 0,
  },
};

function getStatus() {
  const s = { ...state };
  s.errorSim = { ...state.errorSim };
  if (s.routeWaypoints) s.routeWaypoints = [...s.routeWaypoints];
  s.currentLat = state.lastSentLat != null ? state.lastSentLat : state.lat;
  s.currentLon = state.lastSentLon != null ? state.lastSentLon : state.lon;
  return s;
}

function setLastSentPosition(lat, lon) {
  state.lastSentLat = lat;
  state.lastSentLon = lon;
}

function setConfig(params) {
  if (params.lat !== undefined && params.lat !== '') state.lat = parseFloat(params.lat) || 0;
  if (params.lon !== undefined && params.lon !== '') state.lon = parseFloat(params.lon) || 0;
  if (params.alt !== undefined && params.alt !== '') state.alt = parseFloat(params.alt) || 0;
  if (params.sats !== undefined && params.sats !== '') state.sats = parseInt(params.sats, 10) || 0;
  if (params.satsMin !== undefined && params.satsMin !== '') {
    const v = parseInt(params.satsMin, 10);
    state.satsMin = isNaN(v) ? null : Math.max(0, Math.min(12, v));
  }
  if (params.satsMax !== undefined && params.satsMax !== '') {
    const v = parseInt(params.satsMax, 10);
    state.satsMax = isNaN(v) ? null : Math.max(0, Math.min(12, v));
  }
  if (params.course !== undefined && params.course !== '') state.course = parseFloat(params.course) || 0;
  if (params.baud !== undefined && params.baud !== '') state.baud = parseInt(params.baud, 10) || 9600;
  if (params.routeOn !== undefined) state.routeOn = params.routeOn === '1' || params.routeOn === true;
  if (params.routeRadius !== undefined && params.routeRadius !== '') state.routeRadius = parseFloat(params.routeRadius) || 50;
  if (params.speedKmh !== undefined && params.speedKmh !== '') state.speedKmh = parseFloat(params.speedKmh) || 30;
  if (params.speedMinKmh !== undefined && params.speedMinKmh !== '') state.speedMinKmh = Math.max(0, parseFloat(params.speedMinKmh) ?? state.speedKmh);
  if (params.speedMaxKmh !== undefined && params.speedMaxKmh !== '') state.speedMaxKmh = Math.max(0, parseFloat(params.speedMaxKmh) ?? state.speedKmh);
  if (state.speedMinKmh != null && state.speedMaxKmh != null && state.speedMinKmh > state.speedMaxKmh) {
    const t = state.speedMinKmh; state.speedMinKmh = state.speedMaxKmh; state.speedMaxKmh = t;
  }
  state.currentSpeedKmh = null; // reiniciar simulación de velocidad al cambiar config
  if (params.intervalMs !== undefined && params.intervalMs !== '') state.intervalMs = Math.max(200, parseInt(params.intervalMs, 10) || 1000);
  if (params.routeWaypoints !== undefined) {
    let newWp = null;
    if (typeof params.routeWaypoints === 'string' && params.routeWaypoints.trim()) {
      try {
        const arr = JSON.parse(params.routeWaypoints);
        newWp = Array.isArray(arr) ? arr.filter(w => w && typeof w.lat === 'number' && typeof w.lon === 'number') : null;
      } catch (_) {
        newWp = null;
      }
    } else if (Array.isArray(params.routeWaypoints)) {
      newWp = params.routeWaypoints.filter(w => w && typeof w.lat === 'number' && typeof w.lon === 'number');
    }
    const sameRoute = state.routeWaypoints && newWp && state.routeWaypoints.length === newWp.length
      && state.routeWaypoints.length > 0
      && state.routeWaypoints[0].lat === newWp[0].lat && state.routeWaypoints[0].lon === newWp[0].lon
      && state.routeWaypoints[state.routeWaypoints.length - 1].lat === newWp[newWp.length - 1].lat
      && state.routeWaypoints[state.routeWaypoints.length - 1].lon === newWp[newWp.length - 1].lon;
    state.routeWaypoints = newWp;
    if (!sameRoute) {
      state.routeProgress = null;
      if (state.routeWaypoints && state.routeWaypoints.length > 0) {
        state.lat = state.routeWaypoints[0].lat;
        state.lon = state.routeWaypoints[0].lon;
      }
    }
  }
  if (params.errorSim !== undefined && typeof params.errorSim === 'object') {
    const e = params.errorSim;
    if (e.noFix !== undefined) state.errorSim.noFix = !!e.noFix;
    if (e.badHdop !== undefined) state.errorSim.badHdop = !!e.badHdop;
    if (e.jitterMeters !== undefined) state.errorSim.jitterMeters = Math.max(0, parseFloat(e.jitterMeters) || 0);
    if (e.dropPercent !== undefined) state.errorSim.dropPercent = Math.min(100, Math.max(0, parseFloat(e.dropPercent) || 0));
  }
  if (params.noFix !== undefined) state.errorSim.noFix = params.noFix === '1' || params.noFix === true;
  if (params.badHdop !== undefined) state.errorSim.badHdop = params.badHdop === '1' || params.badHdop === true;
  if (params.jitterMeters !== undefined && params.jitterMeters !== '') state.errorSim.jitterMeters = Math.max(0, parseFloat(params.jitterMeters) || 0);
  if (params.dropPercent !== undefined && params.dropPercent !== '') state.errorSim.dropPercent = Math.min(100, Math.max(0, parseFloat(params.dropPercent) || 0));
}

function start() {
  state.enabled = true;
  state.lastTick = null;
}

function stop() {
  state.enabled = false;
  state.lastTick = null;
}

module.exports = {
  getStatus,
  setConfig,
  start,
  stop,
  setLastSentPosition,
  getStateRef: () => state,
};
