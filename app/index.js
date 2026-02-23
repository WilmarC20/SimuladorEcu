'use strict';

const express = require('express');
const path = require('path');

const config = require('./config');
const { loadLegacyWebUiHtml } = require('./lib/legacy-ui');
const { startObdTcpServer } = require('./lib/obd-tcp-server');
const { startObdBtServer } = require('./lib/obd-bt-server');
const routesHost = require('./routes/host');
const routesSystem = require('./routes/system');
const routesGpsSerial = require('./routes/gps-serial');
const routesGpsEmulator = require('./routes/gps-emulator');
const routesBt = require('./routes/bt');
const routesObd = require('./routes/obd');
const routesEcuProfiles = require('./routes/ecu-profiles');
const routesSavedRoutes = require('./routes/saved-routes');
const routesTorqueImport = require('./routes/torque-import');
const { getConnections, getLog, getConnectionTypes } = require('./lib/obd-connection-logger');

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason && reason.stack ? reason.stack : reason);
});

let SerialPort = null;
try {
  const sp = require('serialport');
  SerialPort = sp.SerialPort || null;
} catch (e) {
  SerialPort = null;
}

const app = express();
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

const PUBLIC_DIR = path.join(__dirname, 'public');

routesSystem.setSerialPort(SerialPort);
routesGpsSerial.setSerialPort(SerialPort);

app.use('/api/host', routesHost);
app.use('/api/system', routesSystem);
app.use('/api/gps-serial', routesGpsSerial);
app.use('/api/gps', routesGpsEmulator);
app.use('/api/bt', routesBt);
app.get('/api/connections', (req, res) => {
  try {
    res.json({ connections: getConnections(), types: getConnectionTypes() });
  } catch (err) {
    console.error('GET /api/connections error:', err);
    res.status(500).json({ connections: [], types: getConnectionTypes(), error: (err && err.message) || 'Error' });
  }
});
app.get('/api/connection-log', (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const connectionId = (req.query.connectionId && String(req.query.connectionId).trim()) || undefined;
    res.json({ log: getLog(limit, connectionId) });
  } catch (err) {
    console.error('GET /api/connection-log error:', err);
    res.status(500).json({ log: [], error: (err && err.message) || 'Error' });
  }
});
app.use('/api', routesObd);
app.use('/api/ecu-profiles', routesEcuProfiles);

app.get('/api/config', (req, res) => {
  res.json({
    googleMapsApiKey: config.GOOGLE_MAPS_API_KEY || '',
    googleMapsMapId: config.GOOGLE_MAPS_MAP_ID || '',
  });
});
app.use('/api/saved-routes', routesSavedRoutes);
app.use('/api/torque-import', routesTorqueImport);

app.use(express.static(PUBLIC_DIR));
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});
app.get('/classic', (req, res) => {
  res.type('text/html').send(loadLegacyWebUiHtml());
});

startObdTcpServer(config.OBD_TCP_PORT);
startObdBtServer(config.OBD_TCP_PORT);

try {
  const { startObdCanResponder } = require('./lib/obd-can-responder');
  startObdCanResponder('can0');
} catch (e) {
  // CAN responder opcional (requiere socketcan y can0 UP)
}

const httpServer = app.listen(config.HTTP_PORT, '0.0.0.0', () => {
  console.log('Dashboard OBD2 + GPS: http://0.0.0.0:' + config.HTTP_PORT + '/');
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('Puerto ' + config.HTTP_PORT + ' en uso. Para liberar: pkill -f "node index.js"  o  kill $(lsof -t -i:' + config.HTTP_PORT + ')');
    process.exit(1);
  }
  throw err;
});
