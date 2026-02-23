'use strict';

/**
 * Gestión de perfiles de ECU cargables desde JSON.
 * Permite cambiar el perfil activo en runtime sin romper TCP/CAN/BT.
 * Si no hay perfil cargado, se usa el perfil default interno (comportamiento actual).
 */
const path = require('path');
const fs = require('fs');

const PROFILE_DIR = path.join(__dirname, '..', 'ecu-profiles');
const DEFAULT_PROFILE_NAME = '__default__';

/** Perfil activo en memoria (objeto ya validado). null = usar default interno. */
let activeProfile = null;
/** Nombre del archivo cargado (sin .json), para referencia. */
let activeProfileName = null;

/**
 * Perfil por defecto interno: equivalente al motor OBD actual (PIDs 01 04 05 0C 0D 0F 2F 20 40, 0101).
 * requestId/responseId para compatibilidad CAN 11-bit.
 */
function getDefaultProfile() {
  return {
    vehicleName: 'Generic OBD2 Simulator (default)',
    protocol: 'ISO15765-4_CAN_11BIT_500K',
    requestId: '0x7DF',
    responseId: '0x7E8',
    pids: [
      { id: '04', name: 'EngineLoad', nameKey: 'engineLoadPct', bytes: 1, encode: 'Math.round(value*255/100)', min: 0, max: 100 },
      { id: '05', name: 'CoolantTemp', nameKey: 'coolantC', bytes: 1, encode: 'value+40', min: -40, max: 215 },
      { id: '0C', name: 'EngineRPM', nameKey: 'rpm', bytes: 2, encode: 'Math.round(value*4)', min: 0, max: 16383 },
      { id: '0D', name: 'VehicleSpeed', nameKey: 'speedKph', bytes: 1, encode: 'value', min: 0, max: 255 },
      { id: '0F', name: 'IntakeTemp', nameKey: 'intakeC', bytes: 1, encode: 'value+40', min: -40, max: 215 },
      { id: '2F', name: 'FuelLevel', nameKey: 'fuelPct', bytes: 1, encode: 'Math.round(value*255/100)', min: 0, max: 100 },
    ],
  };
}

/**
 * Valida estructura mínima de un perfil.
 * @param {object} profile - Objeto leído del JSON
 * @returns {{ valid: boolean, error?: string }}
 */
function validate(profile) {
  if (!profile || typeof profile !== 'object') return { valid: false, error: 'Perfil debe ser un objeto' };
  if (!profile.vehicleName || typeof profile.vehicleName !== 'string') return { valid: false, error: 'vehicleName requerido (string)' };
  if (!Array.isArray(profile.pids)) return { valid: false, error: 'pids debe ser un array' };
  for (let i = 0; i < profile.pids.length; i++) {
    const p = profile.pids[i];
    if (!p || typeof p !== 'object') return { valid: false, error: `pids[${i}] debe ser un objeto` };
    const id = p.id != null ? String(p.id).toUpperCase().replace(/^0X/, '') : '';
    if (!/^[0-9A-F]{1,2}$/.test(id)) return { valid: false, error: `pids[${i}].id debe ser hex (ej. 04, 0C)` };
    if (!p.name || typeof p.name !== 'string') return { valid: false, error: `pids[${i}].name requerido` };
    const bytes = p.bytes != null ? parseInt(p.bytes, 10) : 1;
    if (bytes < 1 || bytes > 4) return { valid: false, error: `pids[${i}].bytes debe ser 1-4` };
    if (!p.encode && !p.special) return { valid: false, error: `pids[${i}].encode o .special requerido` };
  }
  return { valid: true };
}

/**
 * Normaliza un perfil cargado: ids en mayúsculas de 2 caracteres, nameKey si no existe (desde name).
 */
function normalizeProfile(profile) {
  const pids = profile.pids.map((p) => {
    const id = String(p.id).toUpperCase().replace(/^0X/, '').padStart(2, '0');
    const nameKey = p.nameKey != null ? p.nameKey : nameToDataKey(p.name);
    return {
      id,
      name: p.name,
      nameKey: nameKey || undefined,
      bytes: Math.max(1, Math.min(4, parseInt(p.bytes, 10) || 1)),
      encode: p.encode != null ? String(p.encode) : undefined,
      min: p.min != null ? Number(p.min) : undefined,
      max: p.max != null ? Number(p.max) : undefined,
      special: p.special || undefined,
    };
  });
  return {
    vehicleName: String(profile.vehicleName),
    protocol: profile.protocol != null ? String(profile.protocol) : 'ISO15765-4_CAN_11BIT_500K',
    requestId: profile.requestId != null ? String(profile.requestId) : '0x7DF',
    responseId: profile.responseId != null ? String(profile.responseId) : '0x7E8',
    pids,
  };
}

/** Mapeo nombre estándar OBD -> clave en engine.data */
const NAME_TO_DATA_KEY = {
  ENGINELOAD: 'engineLoadPct',
  COOLANTTEMP: 'coolantC',
  ENGINERPM: 'rpm',
  VEHICLESPEED: 'speedKph',
  INTAKETEMP: 'intakeC',
  FUELLEVEL: 'fuelPct',
};

function nameToDataKey(name) {
  if (!name || typeof name !== 'string') return null;
  const key = name.replace(/\s+/g, '').toUpperCase();
  return NAME_TO_DATA_KEY[key] || null;
}

/**
 * Lista todos los perfiles disponibles en app/ecu-profiles/*.json
 * @returns {{ list: Array<{ name: string, vehicleName: string, protocol?: string, error?: string }> }}
 */
function loadAll() {
  const list = [];
  try {
    if (!fs.existsSync(PROFILE_DIR)) return { list };
    const files = fs.readdirSync(PROFILE_DIR).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const name = f.replace(/\.json$/i, '');
      try {
        const raw = fs.readFileSync(path.join(PROFILE_DIR, f), 'utf8');
        const profile = JSON.parse(raw);
        const result = validate(profile);
        if (!result.valid) {
          list.push({ name, vehicleName: name, error: result.error });
          continue;
        }
        const normalized = normalizeProfile(profile);
        list.push({
          name,
          vehicleName: normalized.vehicleName,
          protocol: normalized.protocol,
          requestId: normalized.requestId,
          responseId: normalized.responseId,
          pidsCount: normalized.pids.length,
        });
      } catch (e) {
        list.push({ name, vehicleName: name, error: e.message || 'Error al cargar' });
      }
    }
  } catch (e) {
    // PROFILE_DIR no existe o no readable
  }
  return { list };
}

/**
 * Carga y activa un perfil por nombre (sin .json).
 * @param {string} name - Nombre del archivo sin extensión (ej. captiva_2010_2.4)
 * @returns {{ ok: boolean, error?: string, profile?: object }}
 */
function load(name) {
  const n = String(name || '').trim().replace(/\.json$/i, '');
  if (!n) {
    activeProfile = null;
    activeProfileName = null;
    return { ok: true, profile: getDefaultProfile(), active: null };
  }
  const filePath = path.join(PROFILE_DIR, n + '.json');
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: 'Archivo no encontrado: ' + n + '.json' };
    const raw = fs.readFileSync(filePath, 'utf8');
    const profile = JSON.parse(raw);
    const result = validate(profile);
    if (!result.valid) return { ok: false, error: result.error };
    const normalized = normalizeProfile(profile);
    activeProfile = normalized;
    activeProfileName = n;
    return { ok: true, profile: normalized, active: n };
  } catch (e) {
    activeProfile = null;
    activeProfileName = null;
    return { ok: false, error: e.message || 'Error al cargar perfil' };
  }
}

/**
 * Devuelve un perfil por nombre sin activarlo. Para name vacío o '__default__' devuelve el default interno.
 * @param {string} name - Nombre del archivo sin .json
 * @returns {object|null} Perfil normalizado o null si no existe / inválido
 */
function getProfileByName(name) {
  const n = String(name || '').trim().replace(/\.json$/i, '');
  if (!n || n === DEFAULT_PROFILE_NAME) return getDefaultProfile();
  const filePath = path.join(PROFILE_DIR, n + '.json');
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf8');
    const profile = JSON.parse(raw);
    const result = validate(profile);
    if (!result.valid) return null;
    return normalizeProfile(profile);
  } catch (_) {
    return null;
  }
}

/**
 * Devuelve el perfil activo (objeto normalizado). Si no hay ninguno cargado, el default interno.
 */
function getActiveProfile() {
  return activeProfile || getDefaultProfile();
}

/**
 * Nombre del perfil actualmente cargado (sin .json), o null si se usa el default.
 */
function getActiveProfileName() {
  return activeProfileName;
}

/**
 * Guarda un perfil en disco. profileId = nombre del archivo (sin .json).
 * @param {string} profileId - Identificador del perfil (nombre de archivo)
 * @param {object} data - { vehicleName, protocol, requestId?, responseId?, pids[], typicalDtcs?[] }
 * @returns {{ ok: boolean, path?: string, error?: string }}
 */
function saveProfile(profileId, data) {
  const id = String(profileId || '').trim().replace(/\.json$/i, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!id) return { ok: false, error: 'profileId inválido' };
  const profile = {
    vehicleName: data.vehicleName != null ? String(data.vehicleName) : 'Sin nombre',
    protocol: data.protocol != null ? String(data.protocol) : 'ISO15765-4_CAN_11BIT_500K',
    requestId: data.requestId != null ? String(data.requestId) : '0x7DF',
    responseId: data.responseId != null ? String(data.responseId) : '0x7E8',
    pids: Array.isArray(data.pids) ? data.pids.map((p) => ({
      id: p.id,
      name: p.name,
      bytes: p.bytes,
      encode: p.encode,
      min: p.min,
      max: p.max,
    })) : [],
  };
  if (Array.isArray(data.typicalDtcs) && data.typicalDtcs.length > 0) {
    profile.typicalDtcs = data.typicalDtcs;
  }
  const result = validate(profile);
  if (!result.valid) return { ok: false, error: result.error };
  try {
    if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true });
  } catch (e) {
    return { ok: false, error: 'No se pudo crear la carpeta de perfiles: ' + (e.message || '') };
  }
  const filePath = path.join(PROFILE_DIR, id + '.json');
  try {
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message || 'Error al escribir el archivo' };
  }
}

module.exports = {
  loadAll,
  load,
  getProfileByName,
  getActiveProfile,
  getActiveProfileName,
  getDefaultProfile,
  validate,
  normalizeProfile,
  saveProfile,
  PROFILE_DIR,
  DEFAULT_PROFILE_NAME,
};
