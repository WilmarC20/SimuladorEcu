'use strict';

const express = require('express');
const obd = require('../lib/obd-engine');
const { processCommand } = require('../lib/obd-command');
const { getBtServerState } = require('../lib/obd-bt-server');
const { getConnections, getLog, getConnectionTypes } = require('../lib/obd-connection-logger');
const ecuProfileManager = require('../lib/ecu-profile-manager');

const router = express.Router();

router.get('/dashboard', (req, res) => {
  const snapshot = obd.getSnapshot();
  const sim = {
    enabled: obd.isSimulationEnabled(),
    profile: obd.simulationProfile(),
    errorSim: obd.getErrorSimConfig(),
  };
  const btState = getBtServerState();
  const ecuActive = ecuProfileManager.getActiveProfileName();
  const ecuProfile = ecuProfileManager.getActiveProfile();
  res.json({
    ...snapshot,
    sim,
    ecuProfile: ecuActive ? { active: ecuActive, vehicleName: ecuProfile.vehicleName } : { active: null, vehicleName: ecuProfile.vehicleName },
    wifiTcpClient: false,
    wifiTcpPort: 35000,
    apIp: '',
    staIp: '',
    can: { enabled: false },
    btAvailable: btState.available,
    btStarted: btState.listening,
    btConnected: btState.connected,
    btServerError: btState.error || undefined,
  });
});

router.get('/bt-server-status', (req, res) => {
  res.json(getBtServerState());
});

router.get('/connections', (req, res) => {
  try {
    res.json({
      connections: getConnections(),
      types: getConnectionTypes(),
    });
  } catch (err) {
    console.error('GET /connections error:', err);
    res.status(500).json({ connections: [], types: getConnectionTypes(), error: (err && err.message) || 'Error' });
  }
});

router.get('/connection-log', (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
    const connectionId = (req.query.connectionId && String(req.query.connectionId).trim()) || undefined;
    res.json({ log: getLog(limit, connectionId) });
  } catch (err) {
    console.error('GET /connection-log error:', err);
    res.status(500).json({ log: [], error: (err && err.message) || 'Error' });
  }
});

router.post('/set_values', (req, res) => {
  const body = req.body || {};
  obd.setValues({
    speed: body.speed,
    rpm: body.rpm,
    coolantTemp: body.coolantTemp,
    engineLoad: body.engineLoad,
    intakeTemp: body.intakeTemp,
    fuelLevel: body.fuelLevel,
  });
  res.json({ ok: true });
});

router.get('/dtc', (req, res) => {
  res.json(obd.getDtcJson());
});

router.post('/set_dtc', (req, res) => {
  const code = (req.body && req.body.code) ? String(req.body.code).trim() : '';
  const mode = (req.body && req.body.mode) ? String(req.body.mode) : 'stored';
  const on = (req.body && req.body.on) === '1' || (req.body && req.body.on) === true;
  if (!code) return res.status(400).json({ ok: false, msg: 'Falta code' });
  const ok = obd.setDtc(code, on, mode);
  res.json(ok ? { ok: true } : { ok: false, msg: 'Código DTC no válido' });
});

router.post('/clear_dtcs', (req, res) => {
  obd.clearDtc();
  res.json({ ok: true });
});

router.post('/simulation/start', (req, res) => {
  const profile = (req.body && req.body.profile) ? String(req.body.profile) : 'idle';
  obd.startSimulation(profile);
  res.json({ ok: true });
});

router.post('/simulation/stop', (req, res) => {
  obd.stopSimulation();
  res.json({ ok: true });
});

router.get('/simulation/errors', (req, res) => {
  res.json(obd.getErrorSimConfig());
});

router.post('/simulation/errors', (req, res) => {
  const body = req.body || {};
  if (body.failPids !== undefined) obd.setErrorSimFailPids(body.failPids);
  if (body.noisePercent !== undefined) obd.setErrorSimNoise(body.noisePercent);
  res.json({ ok: true, ...obd.getErrorSimConfig() });
});

router.get('/command', (req, res) => {
  const c = (req.query && req.query.c) ? String(req.query.c).trim() : '';
  if (!c) return res.status(400).json({ raw: '', msg: 'Falta c' });
  const raw = processCommand(c);
  res.json({ raw });
});

router.post('/command', (req, res) => {
  const c = (req.body && req.body.c) ? String(req.body.c).trim() : '';
  if (!c) return res.status(400).json({ raw: '', msg: 'Falta c' });
  const raw = processCommand(c);
  res.json({ raw });
});

module.exports = router;
