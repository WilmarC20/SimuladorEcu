'use strict';

/**
 * Registro de dispositivos conectados al emulador OBD2 y log de peticiones/respuestas.
 * Fuentes: Puerto OBD (CAN), Bluetooth, WiFi (TCP).
 */
const MAX_LOG_ENTRIES = 500;
const MAX_CONNECTIONS = 50;

const connections = new Map(); // id -> { id, type, address, macOrIp, connectedAt, lastActivity }
const logEntries = []; // { ts, connectionId, type, request, response }

function formatAddress(addr) {
  if (addr == null) return '—';
  if (Buffer.isBuffer(addr)) return addr.toString('hex').toUpperCase().replace(/(..)/g, '$1:').slice(0, -1);
  return String(addr).trim() || '—';
}

function addConnection(id, type, address, macOrIp) {
  const key = id || (type + '-' + (address || '').toString());
  const now = Date.now();
  connections.set(key, {
    id: key,
    type,
    address: address != null ? String(address).trim() : '',
    macOrIp: macOrIp != null ? String(macOrIp).trim() : formatAddress(address),
    connectedAt: now,
    lastActivity: now,
  });
  return key;
}

function removeConnection(id) {
  connections.delete(id);
}

function updateActivity(id) {
  const c = connections.get(id);
  if (c) c.lastActivity = Date.now();
}

function logExchange(connectionId, request, response) {
  const ts = Date.now();
  updateActivity(connectionId);
  logEntries.push({
    ts,
    connectionId,
    request: request != null ? String(request).trim().slice(0, 256) : '',
    response: response != null ? String(response).trim().slice(0, 512) : '',
  });
  if (logEntries.length > MAX_LOG_ENTRIES) logEntries.shift();
}

function getConnections() {
  const list = Array.from(connections.values()).map((c) => ({
    id: c.id,
    type: c.type,
    address: c.address,
    macOrIp: c.macOrIp,
    connectedAt: c.connectedAt,
    lastActivity: c.lastActivity,
  }));
  list.sort((a, b) => b.lastActivity - a.lastActivity);
  return list;
}

function getLog(limit = 100, connectionId = null) {
  let out = logEntries.slice(-limit);
  if (connectionId) out = out.filter((e) => e.connectionId === connectionId);
  return out.reverse();
}

function getConnectionTypes() {
  return [
    { value: 'can', label: 'Puerto OBD (CAN)' },
    { value: 'bt', label: 'Bluetooth' },
    { value: 'tcp', label: 'WiFi (TCP)' },
  ];
}

module.exports = {
  addConnection,
  removeConnection,
  updateActivity,
  logExchange,
  getConnections,
  getLog,
  getConnectionTypes,
  formatAddress,
};
