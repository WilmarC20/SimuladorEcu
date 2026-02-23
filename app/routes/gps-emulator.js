'use strict';

const express = require('express');
const gpsState = require('../lib/gps-emulator-state');
const gpsSerialRunner = require('../lib/gps-serial-runner');
const gpsSerialState = require('../lib/gps-serial-state');

const router = express.Router();

router.get('/status', (req, res) => {
  const status = gpsState.getStatus();
  const serial = gpsSerialState.getStatus();
  res.json({
    ...status,
    serialOpen: serial.open,
    serialPath: serial.path,
    serialBaudRate: serial.baudRate,
    lastSentLines: serial.lastSentLines || [],
  });
});

router.post('/config', (req, res) => {
  gpsState.setConfig(req.body || {});
  res.json({ ok: true });
});

router.post('/start', (req, res) => {
  const port = gpsSerialState.getPort();
  const serialStatus = gpsSerialState.getStatus();
  if (!port || !serialStatus.open) {
    return res.status(400).json({
      ok: false,
      msg: 'Abre primero el puerto serial en la pestaña "Emulador GPS NEO" (elige /dev/ttyS0 o /dev/serial0 y pulsa Abrir puerto).',
    });
  }
  gpsState.start();
  gpsSerialRunner.startLoop();
  res.json({ ok: true });
});

router.post('/stop', (req, res) => {
  gpsState.stop();
  gpsSerialRunner.stopLoop();
  res.json({ ok: true });
});

module.exports = router;
