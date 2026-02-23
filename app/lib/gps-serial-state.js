'use strict';

/** Estado del emulador GPS NEO (puerto serial por pines Pi). */
let gpsSerialPort = null;
const gpsSerialStatus = { open: false, path: null, baudRate: null, lastSent: null, lastSentLines: [] };

function getPort() {
  return gpsSerialPort;
}

function setPort(port) {
  gpsSerialPort = port;
}

function getStatus() {
  return { ...gpsSerialStatus, lastSentLines: gpsSerialStatus.lastSentLines.slice() };
}

function setStatus(open, path, baudRate, lastSent) {
  gpsSerialStatus.open = open;
  gpsSerialStatus.path = path;
  gpsSerialStatus.baudRate = baudRate;
  gpsSerialStatus.lastSent = lastSent ?? gpsSerialStatus.lastSent;
}

function setLastSentLines(lines) {
  gpsSerialStatus.lastSentLines = Array.isArray(lines) ? lines.slice() : [];
}

function clearPort() {
  gpsSerialPort = null;
  gpsSerialStatus.open = false;
  gpsSerialStatus.path = null;
  gpsSerialStatus.baudRate = null;
  // No borrar lastSentLines para que sigan viéndose las últimas tramas aunque el puerto se cierre
}

module.exports = {
  getPort,
  setPort,
  getStatus,
  setStatus,
  setLastSentLines,
  clearPort,
};
