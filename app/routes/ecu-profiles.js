'use strict';

const express = require('express');
const ecuProfileManager = require('../lib/ecu-profile-manager');
const { getPidCatalog, getDtcCatalog, getProtocols } = require('../lib/ecu-profile-catalog');

const router = express.Router();

/**
 * GET /api/ecu-profiles
 * Lista perfiles disponibles en app/ecu-profiles/*.json y el perfil activo.
 */
router.get('/', (req, res) => {
  try {
    const { list } = ecuProfileManager.loadAll();
    const active = ecuProfileManager.getActiveProfileName();
    const current = ecuProfileManager.getActiveProfile();
    res.json({
      list,
      active,
      current: active ? { vehicleName: current.vehicleName, protocol: current.protocol, requestId: current.requestId, responseId: current.responseId, pidsCount: current.pids.length } : null,
    });
  } catch (err) {
    console.error('GET /api/ecu-profiles error:', err);
    res.status(500).json({ list: [], active: null, current: null, error: (err && err.message) || 'Error' });
  }
});

/**
 * GET /api/ecu-profiles/detail/:name?
 * Devuelve el contenido de un perfil (sin activarlo). Sin name o name vacío = perfil default.
 */
router.get('/detail/:name?', (req, res) => {
  try {
    const name = (req.params.name || '').trim();
    const profile = ecuProfileManager.getProfileByName(name);
    if (!profile) return res.status(404).json({ error: 'Perfil no encontrado' });
    res.json(profile);
  } catch (err) {
    console.error('GET /api/ecu-profiles/detail/:name error:', err);
    res.status(500).json({ error: (err && err.message) || 'Error' });
  }
});

/**
 * GET /api/ecu-profiles/catalog/pids
 * Catálogo de PIDs OBD2 modo 01 para el creador de perfiles.
 */
router.get('/catalog/pids', (req, res) => {
  try {
    res.json({ pids: getPidCatalog() });
  } catch (err) {
    console.error('GET /api/ecu-profiles/catalog/pids error:', err);
    res.status(500).json({ pids: [], error: (err && err.message) || 'Error' });
  }
});

/**
 * GET /api/ecu-profiles/catalog/dtcs
 * Catálogo de códigos DTC estándar para el creador de perfiles.
 */
router.get('/catalog/dtcs', (req, res) => {
  try {
    res.json({ dtcs: getDtcCatalog() });
  } catch (err) {
    console.error('GET /api/ecu-profiles/catalog/dtcs error:', err);
    res.status(500).json({ dtcs: [], error: (err && err.message) || 'Error' });
  }
});

/**
 * GET /api/ecu-profiles/catalog/protocols
 * Lista de protocolos OBD soportados.
 */
router.get('/catalog/protocols', (req, res) => {
  try {
    res.json({ protocols: getProtocols() });
  } catch (err) {
    console.error('GET /api/ecu-profiles/catalog/protocols error:', err);
    res.status(500).json({ protocols: [], error: (err && err.message) || 'Error' });
  }
});

/**
 * POST /api/ecu-profiles/load
 * Body: { name: "captiva_2010_2.4" } (nombre sin .json).
 * Carga y activa el perfil. name vacío o null = usar perfil default.
 */
router.post('/load', (req, res) => {
  try {
    const name = (req.body && req.body.name != null) ? String(req.body.name).trim() : '';
    const result = ecuProfileManager.load(name || null);
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({
      ok: true,
      active: result.active,
      profile: result.profile ? { vehicleName: result.profile.vehicleName, protocol: result.profile.protocol, requestId: result.profile.requestId, responseId: result.profile.responseId, pidsCount: result.profile.pids.length } : undefined,
    });
  } catch (err) {
    console.error('POST /api/ecu-profiles/load error:', err);
    res.status(500).json({ ok: false, error: (err && err.message) || 'Error' });
  }
});

/**
 * POST /api/ecu-profiles
 * Body: { profileId: string, vehicleName, protocol, requestId?, responseId?, pids: [], typicalDtcs?: [] }
 * Crea/guarda un nuevo perfil en app/ecu-profiles/{profileId}.json
 */
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const profileId = (body.profileId || body.name || '').trim().replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
    if (!profileId) {
      return res.status(400).json({ ok: false, error: 'profileId (o name) requerido' });
    }
    const result = ecuProfileManager.saveProfile(profileId, {
      vehicleName: body.vehicleName || 'Sin nombre',
      protocol: body.protocol || 'ISO15765-4_CAN_11BIT_500K',
      requestId: body.requestId != null ? String(body.requestId) : '0x7DF',
      responseId: body.responseId != null ? String(body.responseId) : '0x7E8',
      pids: Array.isArray(body.pids) ? body.pids : [],
      typicalDtcs: Array.isArray(body.typicalDtcs) ? body.typicalDtcs : undefined,
    });
    if (!result.ok) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({ ok: true, name: profileId, path: result.path });
  } catch (err) {
    console.error('POST /api/ecu-profiles error:', err);
    res.status(500).json({ ok: false, error: (err && err.message) || 'Error' });
  }
});

module.exports = router;
