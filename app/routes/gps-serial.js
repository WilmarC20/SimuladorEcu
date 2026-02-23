'use strict';

const express = require('express');
const { listPorts } = require('../lib/serial');
const gpsState = require('../lib/gps-serial-state');

const router = express.Router();

let SerialPort = null;
function setSerialPort(sp) {
  SerialPort = sp;
}

router.get('/ports', async (req, res) => {
  const ports = await listPorts(SerialPort);
  res.json({ ports: ports.map(p => ({ path: p.path, manufacturer: p.manufacturer || '' })) });
});

router.get('/status', (req, res) => {
  res.json(gpsState.getStatus());
});

router.post('/open', (req, res) => {
  if (!SerialPort) return res.status(501).json({ ok: false, msg: 'Módulo serial no disponible' });
  const { path: portPath, baudRate } = req.body || {};
  if (!portPath || !baudRate) return res.status(400).json({ ok: false, msg: 'Faltan path o baudRate' });
  if (gpsState.getPort()) return res.status(409).json({ ok: false, msg: 'Puerto ya abierto' });

  const baud = Number(baudRate) || 9600;
  const port = new SerialPort({ path: portPath, baudRate: baud }, err => {
    if (err) {
      gpsState.clearPort();
      return res.status(500).json({ ok: false, msg: err.message });
    }
    gpsState.setPort(port);
    gpsState.setStatus(true, portPath, baud, null);
    res.json({ ok: true, ...gpsState.getStatus() });
  });

  port.on('error', () => {
    gpsState.clearPort();
  });
  port.on('close', () => {
    gpsState.clearPort();
  });
});

router.post('/close', (req, res) => {
  const port = gpsState.getPort();
  if (!port) return res.json({ ok: true, msg: 'No había puerto abierto' });
  gpsState.setPort(null);
  gpsState.setStatus(false, null, null, null);
  port.close(() => res.json({ ok: true }));
});

router.post('/send', (req, res) => {
  const port = gpsState.getPort();
  const status = gpsState.getStatus();
  if (!port || !status.open) {
    return res.status(400).json({ ok: false, msg: 'Puerto serial no abierto' });
  }
  const line = (req.body && req.body.line) ? String(req.body.line).trim() : '';
  if (!line) return res.status(400).json({ ok: false, msg: 'Falta line (mensaje NMEA)' });

  const data = line.endsWith('\r\n') ? line : line + '\r\n';
  port.write(data, err => {
    if (err) return res.status(500).json({ ok: false, msg: err.message });
    gpsState.setStatus(true, status.path, status.baudRate, new Date().toISOString());
    res.json({ ok: true, lastSent: gpsState.getStatus().lastSent });
  });
});

module.exports = router;
module.exports.setSerialPort = setSerialPort;
