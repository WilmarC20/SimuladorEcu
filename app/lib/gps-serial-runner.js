'use strict';

/**
 * Bucle que envía tramas NMEA por el puerto serial cuando el emulador está iniciado.
 * Usa el estado del emulador (ruta, errores) y escribe en el puerto de gps-serial-state.
 */
const gpsEmulatorState = require('./gps-emulator-state');
const gpsSerialState = require('./gps-serial-state');
const { advanceRoute } = require('./gps-route');
const { buildNmea } = require('./nmea-generator');

let intervalId = null;

function applyJitter(lat, lon, meters) {
  if (!meters || meters <= 0) return { lat, lon };
  const r = (Math.random() - 0.5) * 2 * meters;
  const bearing = Math.random() * 360;
  const rad = (bearing * Math.PI) / 180;
  const R = 6371000;
  const dLat = (r * Math.cos(rad) / R) * (180 / Math.PI);
  const dLon = (r * Math.sin(rad) / (R * Math.cos((lat * Math.PI) / 180))) * (180 / Math.PI);
  return { lat: lat + dLat, lon: lon + dLon };
}

function tick() {
  try {
    const stateRef = gpsEmulatorState.getStateRef();
    if (!stateRef.enabled) return;

    const port = gpsSerialState.getPort();
    const status = gpsSerialState.getStatus();
    if (!port || !status.open) return;

    const now = Date.now();
    const elapsed = stateRef.lastTick != null ? now - stateRef.lastTick : stateRef.intervalMs;

    const pos = advanceRoute(stateRef, elapsed);
    let lat = pos.lat;
    let lon = pos.lon;
    const jitter = stateRef.errorSim && stateRef.errorSim.jitterMeters ? stateRef.errorSim.jitterMeters : 0;
    const jittered = applyJitter(lat, lon, jitter);
    lat = jittered.lat;
    lon = jittered.lon;

    if (stateRef.errorSim && stateRef.errorSim.dropPercent > 0 && Math.random() * 100 < stateRef.errorSim.dropPercent) {
      gpsEmulatorState.setLastSentPosition(lat, lon);
      return;
    }

    const noFix = stateRef.errorSim && stateRef.errorSim.noFix;
    const hdop = (stateRef.errorSim && stateRef.errorSim.badHdop) ? 99 : 1.0;
    let sats = stateRef.sats;
    const smin = stateRef.satsMin;
    const smax = stateRef.satsMax;
    if (smin != null && smax != null && smax >= smin) {
      sats = Math.min(12, Math.max(0, Math.floor(Math.random() * (smax - smin + 1)) + smin));
    }
    const sentences = buildNmea({
      lat,
      lon,
      alt: pos.alt,
      sats,
      course: pos.course,
      speedKmh: pos.speedKmh,
      hdop,
      noFix,
      date: new Date(),
    });

    const data = sentences.join('\r\n') + '\r\n';
    gpsSerialState.setLastSentLines(sentences);
    gpsEmulatorState.setLastSentPosition(lat, lon);
    stateRef.lastTick = Date.now();
    port.write(data, err => {
      if (err) return;
      gpsSerialState.setStatus(true, status.path, status.baudRate, new Date().toISOString());
    });
  } catch (err) {
    gpsSerialState.setLastSentLines(['$ERR,' + (err && err.message) + '*00']);
  }
}

function startLoop() {
  stopLoop();
  const stateRef = gpsEmulatorState.getStateRef();
  const ms = Math.min(1500, Math.max(200, stateRef.intervalMs || 1000));
  // No poner lastTick aquí: el primer tick debe usar elapsed = intervalMs para avanzar de verdad
  tick();
  intervalId = setInterval(tick, ms);
}

function stopLoop() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = { startLoop, stopLoop, tick };
