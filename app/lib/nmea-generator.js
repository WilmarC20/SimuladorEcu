'use strict';

/**
 * Genera frases NMEA 0183 (GPGGA, GPRMC) con checksum.
 * Compatible con dispositivos que esperan un GPS NEO por UART.
 */

function nmeaChecksum(sentence) {
  let c = 0;
  for (let i = 0; i < sentence.length; i++) c ^= sentence.charCodeAt(i);
  return ('0' + c.toString(16).toUpperCase()).slice(-2);
}

function padNum(n, len, decimals = 0) {
  const s = decimals ? Number(n).toFixed(decimals) : String(Math.round(n));
  return s.padStart(len, '0');
}

/**
 * Minutos en formato NMEA: mm.mmmm (siempre 2 dígitos antes del decimal).
 */
function formatMinutes(min) {
  const minInt = Math.floor(min);
  const minFrac = min - minInt;
  return padNum(minInt, 2) + minFrac.toFixed(4).slice(1);
}

/**
 * Formato lat NMEA: ddmm.mmmm (N/S)
 */
function formatLat(lat) {
  const deg = Math.floor(Math.abs(lat));
  const min = (Math.abs(lat) - deg) * 60;
  const ns = lat >= 0 ? 'N' : 'S';
  return `${padNum(deg, 2)}${formatMinutes(min)},${ns}`;
}

/**
 * Formato lon NMEA: dddmm.mmmm (E/W)
 */
function formatLon(lon) {
  const deg = Math.floor(Math.abs(lon));
  const min = (Math.abs(lon) - deg) * 60;
  const ew = lon >= 0 ? 'E' : 'W';
  return `${padNum(deg, 3)}${formatMinutes(min)},${ew}`;
}

/**
 * UTC time hhmmss.ss
 */
function formatTime(date) {
  const h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const s = date.getUTCSeconds();
  const ms = date.getUTCMilliseconds();
  return `${padNum(h, 2)}${padNum(m, 2)}${padNum(s + ms / 1000, 2, 2)}`;
}

/**
 * Date ddmmyy
 */
function formatDate(date) {
  const d = date.getUTCDate();
  const m = date.getUTCMonth() + 1;
  const y = date.getUTCFullYear() % 100;
  return `${padNum(d, 2)}${padNum(m, 2)}${padNum(y, 2)}`;
}

/**
 * Velocidad en nudos (knots) para NMEA
 */
function kmhToKnots(kmh) {
  return (kmh || 0) / 1.852;
}

/**
 * @param {object} opts - { lat, lon, alt, sats, course, speedKmh, hdop, noFix, date }
 * @returns {string[]} Frases NMEA sin CRLF (GPGGA, GPRMC)
 */
function buildNmea(opts) {
  const date = opts.date || new Date();
  const noFix = opts.noFix === true;
  const lat = opts.lat != null ? opts.lat : 0;
  const lon = opts.lon != null ? opts.lon : 0;
  const alt = opts.alt != null ? opts.alt : 0;
  const sats = noFix ? 0 : (opts.sats != null ? Math.min(12, Math.max(0, opts.sats)) : 8);
  const course = opts.course != null ? opts.course : 0;
  const speedKnots = kmhToKnots(opts.speedKmh != null ? opts.speedKmh : 0);
  const hdop = opts.hdop != null ? opts.hdop : (noFix ? 99 : 1.0);
  const timeStr = formatTime(date);
  const dateStr = formatDate(date);
  const sentences = [];

  // $GPGGA - posición y fix
  const fixQuality = noFix ? '0' : '1';
  const gga = [
    'GPGGA',
    timeStr,
    formatLat(lat),
    formatLon(lon),
    fixQuality,
    padNum(sats, 2),
    String(Number(hdop).toFixed(1)),
    String(Number(alt).toFixed(1)),
    'M',
    '0.0',
    'M',
    '',
    '',
  ].join(',');
  sentences.push('$' + gga + '*' + nmeaChecksum(gga));

  // $GPRMC - recomendado mínimo
  const rmcStatus = noFix ? 'V' : 'A'; // V = invalid, A = valid
  const rmc = [
    'GPRMC',
    timeStr,
    rmcStatus,
    formatLat(lat),
    formatLon(lon),
    String(Number(speedKnots).toFixed(1)),
    String(Number(course).toFixed(1)),
    dateStr,
    '',
    '',
    'A',
  ].join(',');
  sentences.push('$' + rmc + '*' + nmeaChecksum(rmc));

  return sentences;
}

module.exports = { buildNmea, nmeaChecksum, formatLat, formatLon };
