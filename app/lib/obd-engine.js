'use strict';

/**
 * Motor del simulador OBD2: valores, DTC y simulación.
 * PIDs y codificación vienen del perfil activo (ecu-profile-manager); si no hay perfil, se usa el default.
 */
const ecuProfileManager = require('./ecu-profile-manager');
const PROFILE_IDLE = 'idle';
const PROFILE_CITY = 'city';
const PROFILE_HIGHWAY = 'highway';

const MAX_DTC = 12;

function byteToHex(value) {
  const v = Math.max(0, Math.min(255, value));
  return v.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Construye los 4 bytes del bitmap de PIDs soportados para un rango [rangeStart, rangeEnd].
 * OBD: byte0 bit7 = primer PID del rango, byte0 bit0 = PID rangeStart+7, etc.
 */
function buildPidBitmap(profile, rangeStart, rangeEnd) {
  const bytes = [0, 0, 0, 0];
  if (!profile || !Array.isArray(profile.pids)) return bytes;
  for (const p of profile.pids) {
    const pidNum = parseInt(p.id, 16);
    if (!Number.isFinite(pidNum) || pidNum < rangeStart || pidNum > rangeEnd) continue;
    const bitIndex = pidNum - rangeStart;
    const byteIndex = bitIndex >> 3;
    const bitInByte = 7 - (bitIndex & 7);
    if (byteIndex < 4) bytes[byteIndex] |= 1 << bitInByte;
  }
  return bytes;
}

/**
 * Evalúa la fórmula encode del perfil (expresión en JS con variable 'value'). Uso interno; perfiles en app/ecu-profiles/.
 */
function runEncode(encodeStr, value) {
  if (encodeStr == null || encodeStr === '') return value;
  try {
    const fn = new Function('value', 'return (' + encodeStr + ')');
    const out = fn(Number(value));
    return Number.isFinite(out) ? out : 0;
  } catch (_) {
    return 0;
  }
}

function normalizeDtc(code) {
  const s = String(code).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
  return s.length === 5 ? s : '';
}

function encodeDtcCode(code) {
  if (code.length !== 5) return null;
  const family = code[0];
  let familyBits = 0;
  if (family === 'P') familyBits = 0;
  else if (family === 'C') familyBits = 1;
  else if (family === 'B') familyBits = 2;
  else if (family === 'U') familyBits = 3;
  else return null;
  const d1 = parseInt(code[1], 10);
  const d2 = parseInt(code[2], 10);
  const d3 = parseInt(code[3], 10);
  const d4 = parseInt(code[4], 10);
  if ([d1, d2, d3, d4].some(n => isNaN(n) || n < 0 || n > 9)) return null;
  const a = (familyBits << 6) | ((d1 & 0x03) << 4) | (d2 & 0x0f);
  const b = ((d3 & 0x0f) << 4) | (d4 & 0x0f);
  return { a, b };
}

class ObdEngine {
  constructor() {
    this.data = {
      speedKph: 0,
      rpm: 820,
      coolantC: 86,
      engineLoadPct: 18,
      intakeC: 28,
      fuelPct: 64,
    };
    this.batteryMv = 12600;
    this.dtc = [];
    /** Snapshot de datos del motor cuando se guardó el último DTC; usado por modo 02 (freeze frame). */
    this.freezeFrameData = null;
    this.simulationEnabled = false;
    this.simulationProfile = PROFILE_IDLE;
    this.lastSimTick = 0;
    this.simPhase = 0;
    /** PIDs que simulan fallo: devuelven NO DATA (ej. ['010C','010D']) */
    this.errorSimFailPids = [];
    /** Inestabilidad 0..100: ruido ±N% sobre el valor (para simular sensor inestable) */
    this.errorSimNoisePercent = 0;
    /** Modo 09: información vehículo (VIN 17 chars, CALID, CVN). Configurable desde perfil o setVehicleInfo(). */
    this.vehicleInfo = { vin: 'SIMULATOR00000001', calid: 'SIM_CAL_001', cvn: '12345678' };
    this.setDtc('P0300', true, 'stored');
  }

  setVehicleInfo(vin, calid, cvn) {
    if (vin != null && String(vin).trim()) this.vehicleInfo.vin = String(vin).trim().slice(0, 17).padEnd(17, ' ').slice(0, 17);
    if (calid != null && String(calid).trim()) this.vehicleInfo.calid = String(calid).trim().slice(0, 32);
    if (cvn != null && String(cvn).trim()) this.vehicleInfo.cvn = String(cvn).trim().slice(0, 8);
  }

  setErrorSimFailPids(pids) {
    this.errorSimFailPids = Array.isArray(pids) ? pids.filter(p => /^01[0-9A-Fa-f]{2}$/.test(p)) : [];
  }

  setErrorSimNoise(percent) {
    const p = parseInt(percent, 10);
    this.errorSimNoisePercent = isNaN(p) ? 0 : Math.max(0, Math.min(100, p));
  }

  getErrorSimConfig() {
    return { failPids: [...this.errorSimFailPids], noisePercent: this.errorSimNoisePercent };
  }

  getSnapshot() {
    return {
      speed: this.data.speedKph,
      rpm: this.data.rpm,
      coolantTemp: this.data.coolantC,
      engineLoad: this.data.engineLoadPct,
      intakeTemp: this.data.intakeC,
      fuelLevel: this.data.fuelPct,
    };
  }

  getBatteryVoltageText() {
    const v = (this.batteryMv / 1000).toFixed(2);
    return v + 'V';
  }

  setValues(params) {
    if (params.speed !== undefined && params.speed !== '') this.data.speedKph = Math.max(0, parseInt(params.speed, 10) || 0);
    if (params.rpm !== undefined && params.rpm !== '') this.data.rpm = Math.max(0, parseInt(params.rpm, 10) || 0);
    if (params.coolantTemp !== undefined && params.coolantTemp !== '') this.data.coolantC = parseInt(params.coolantTemp, 10) || 0;
    if (params.engineLoad !== undefined && params.engineLoad !== '') this.data.engineLoadPct = Math.max(0, Math.min(100, parseInt(params.engineLoad, 10) || 0));
    if (params.intakeTemp !== undefined && params.intakeTemp !== '') this.data.intakeC = parseInt(params.intakeTemp, 10) || 0;
    if (params.fuelLevel !== undefined && params.fuelLevel !== '') this.data.fuelPct = Math.max(0, Math.min(100, parseInt(params.fuelLevel, 10) || 0));
  }

  setDtc(code, enabled, mode) {
    const norm = normalizeDtc(code);
    if (!norm) return false;
    const enc = encodeDtcCode(norm);
    if (!enc) return false;
    let entry = this.dtc.find(e => e.code === norm);
    if (!entry) {
      if (this.dtc.length >= MAX_DTC) return false;
      entry = { code: norm, stored: false, pending: false, permanent: false };
      this.dtc.push(entry);
    }
    if (mode === 'stored') entry.stored = !!enabled;
    else if (mode === 'pending') entry.pending = !!enabled;
    else if (mode === 'all') {
      entry.stored = !!enabled;
      entry.pending = !!enabled;
    }
    if (enabled) this.freezeFrameData = { ...this.data };
    return true;
  }

  clearDtc() {
    this.dtc.length = 0;
    this.freezeFrameData = null;
  }

  getDtcJson() {
    return this.dtc.filter(e => e.stored || e.pending).map(e => ({
      code: e.code,
      stored: e.stored,
      pending: e.pending,
    }));
  }

  countDtcForMode(modeKey) {
    if (modeKey === '3') return this.dtc.filter(e => e.stored).length;
    if (modeKey === '7') return this.dtc.filter(e => e.pending).length;
    if (modeKey === 'a') return this.dtc.filter(e => e.stored || e.pending).length;
    return 0;
  }

  _noisy(value, minVal = 0, maxVal = 255) {
    if (this.errorSimNoisePercent <= 0) return value;
    const delta = value * (this.errorSimNoisePercent / 100) * (2 * Math.random() - 1);
    return Math.round(Math.max(minVal, Math.min(maxVal, value + delta)));
  }

  buildMode01Response(cmd) {
    if (this.errorSimFailPids.indexOf(cmd) >= 0) return 'NO DATA';
    const profile = ecuProfileManager.getActiveProfile();
    const d = this.data;

    if (cmd === '0100') {
      const bitmap = buildPidBitmap(profile, 0x01, 0x20);
      bitmap[0] |= 0x80;
      return '41 00 ' + bitmap.map(b => byteToHex(b)).join(' ');
    }
    if (cmd === '0101') return '41 01 00 07 E5 00';
    if (cmd === '0120') {
      const bitmap = buildPidBitmap(profile, 0x21, 0x40);
      return '41 20 ' + bitmap.map(b => byteToHex(b)).join(' ');
    }
    if (cmd === '0140') {
      const bitmap = buildPidBitmap(profile, 0x41, 0x60);
      return '41 40 ' + bitmap.map(b => byteToHex(b)).join(' ');
    }

    if (cmd.length !== 4 || !cmd.startsWith('01')) return 'NO DATA';
    const pidId = cmd.slice(2).toUpperCase().padStart(2, '0');
    const pid = profile.pids.find((p) => p.id.toUpperCase().padStart(2, '0') === pidId);
    if (!pid || !pid.nameKey || !pid.encode) return 'NO DATA';

    let value = d[pid.nameKey];
    if (value == null || value === '') value = 0;
    const min = pid.min != null ? pid.min : 0;
    const max = pid.max != null ? pid.max : 255;
    value = this._noisy(Number(value), min, max);
    let raw = runEncode(pid.encode, value);
    const bytes = pid.bytes || 1;
    if (bytes === 1) {
      raw = Math.max(0, Math.min(255, Math.round(raw)));
      return '41 ' + pid.id + ' ' + byteToHex(raw);
    }
    if (bytes === 2) {
      raw = Math.max(0, Math.min(65535, Math.round(raw)));
      return '41 ' + pid.id + ' ' + byteToHex((raw >> 8) & 0xff) + ' ' + byteToHex(raw & 0xff);
    }
    return 'NO DATA';
  }

  /**
   * Modo 02: freeze frame. Misma codificación que modo 01 pero usando freezeFrameData (snapshot al guardar DTC).
   * cmd02 = PID en 2 caracteres hex (ej. "0C"); frameNum = número de frame (ignorado si solo hay uno).
   */
  buildMode02Response(cmd02, frameNum) {
    const pidId = (cmd02 || '').toUpperCase().padStart(2, '0');
    if (pidId === '02') {
      const list = this.dtc.filter((e) => e.stored || e.pending);
      if (list.length === 0) return 'NO DATA';
      const enc = encodeDtcCode(list[0].code);
      if (!enc) return 'NO DATA';
      return '42 02 ' + byteToHex(enc.a) + ' ' + byteToHex(enc.b);
    }
    const profile = ecuProfileManager.getActiveProfile();
    const d = this.freezeFrameData || this.data;
    const pid = profile.pids.find((p) => p.id.toUpperCase().padStart(2, '0') === pidId);
    if (!pid || !pid.nameKey || !pid.encode) return 'NO DATA';
    let value = d[pid.nameKey];
    if (value == null || value === '') value = 0;
    const min = pid.min != null ? pid.min : 0;
    const max = pid.max != null ? pid.max : 255;
    value = Math.max(min, Math.min(max, Number(value)));
    let raw = runEncode(pid.encode, value);
    const bytes = pid.bytes || 1;
    if (bytes === 1) {
      raw = Math.max(0, Math.min(255, Math.round(raw)));
      return '42 ' + pid.id + ' ' + byteToHex(raw);
    }
    if (bytes === 2) {
      raw = Math.max(0, Math.min(65535, Math.round(raw)));
      return '42 ' + pid.id + ' ' + byteToHex((raw >> 8) & 0xff) + ' ' + byteToHex(raw & 0xff);
    }
    return 'NO DATA';
  }

  /**
   * Modo 09: información del vehículo (VIN, CALID, CVN). VIN en 4 frames de 5+5+5+2 bytes.
   */
  buildMode09Response(pidHex, frameNum) {
    const pid = (pidHex || '').toUpperCase().padStart(2, '0');
    const vi = this.vehicleInfo;
    const vin = (vi.vin || 'SIMULATOR00000001').padEnd(17, ' ').slice(0, 17);

    if (pid === '00') {
      const b0 = 0x40 | 0x10 | 0x04;
      return '49 00 ' + byteToHex(b0) + ' 00 00 00';
    }
    if (pid === '02') {
      const frame = frameNum || 0;
      const bytesPerFrame = 4;
      if (frame === 0) return '49 02 01 11';
      const start = (frame - 1) * bytesPerFrame;
      const chunk = vin.slice(start, start + bytesPerFrame);
      const hex = Array.from(chunk).map((c) => byteToHex(c.charCodeAt(0))).join(' ');
      return '49 02 ' + byteToHex(frame) + ' ' + hex;
    }
    if (pid === '04') {
      const calid = (vi.calid || 'SIM1').slice(0, 4);
      const hex = Array.from(calid).map((c) => byteToHex(c.charCodeAt(0))).join(' ');
      return '49 04 ' + byteToHex(calid.length) + ' ' + hex;
    }
    if (pid === '06') {
      const cvn = (vi.cvn || '12345678').slice(0, 8).padEnd(8, '0');
      const b0 = parseInt(cvn.slice(0, 2), 16) || 0x12;
      const b1 = parseInt(cvn.slice(2, 4), 16) || 0x34;
      const b2 = parseInt(cvn.slice(4, 6), 16) || 0x56;
      const b3 = parseInt(cvn.slice(6, 8), 16) || 0x78;
      return '49 06 ' + byteToHex(b0) + ' ' + byteToHex(b1) + ' ' + byteToHex(b2) + ' ' + byteToHex(b3);
    }
    return 'NO DATA';
  }

  buildMode03Response() {
    const list = this.dtc.filter(e => e.stored);
    if (list.length === 0) return '43 00 00 00 00';
    const bytes = [];
    list.forEach(e => {
      const enc = encodeDtcCode(e.code);
      if (enc) { bytes.push(enc.a, enc.b); }
    });
    const hex = bytes.map(b => byteToHex(b)).join(' ');
    return '43 ' + byteToHex(list.length * 2) + ' ' + hex;
  }

  buildMode07Response() {
    const list = this.dtc.filter(e => e.pending);
    if (list.length === 0) return '47 00 00 00 00';
    const bytes = [];
    list.forEach(e => {
      const enc = encodeDtcCode(e.code);
      if (enc) { bytes.push(enc.a, enc.b); }
    });
    const hex = bytes.map(b => byteToHex(b)).join(' ');
    return '47 ' + byteToHex(list.length * 2) + ' ' + hex;
  }

  buildMode0AResponse() {
    const list = this.dtc.filter(e => e.stored || e.pending);
    if (list.length === 0) return '4A 00 00 00 00';
    const bytes = [];
    list.forEach(e => {
      const enc = encodeDtcCode(e.code);
      if (enc) { bytes.push(enc.a, enc.b); }
    });
    const hex = bytes.map(b => byteToHex(b)).join(' ');
    return '4A ' + byteToHex(list.length * 2) + ' ' + hex;
  }

  startSimulation(profile) {
    this.simulationEnabled = true;
    this.simulationProfile = profile === PROFILE_CITY ? PROFILE_CITY : profile === PROFILE_HIGHWAY ? PROFILE_HIGHWAY : PROFILE_IDLE;
    this.lastSimTick = Date.now();
    this.simPhase = 0;
  }

  stopSimulation() {
    this.simulationEnabled = false;
  }

  isSimulationEnabled() {
    return this.simulationEnabled;
  }

  tickSimulation() {
    if (!this.simulationEnabled) return;
    const now = Date.now();
    const dt = (now - this.lastSimTick) / 1000;
    this.lastSimTick = now;
    this.simPhase += dt * 0.5;
    const t = Math.sin(this.simPhase) * 0.5 + 0.5;
    const d = this.data;
    if (this.simulationProfile === PROFILE_IDLE) {
      d.speedKph = 0;
      d.rpm = 820 + Math.floor(t * 100);
      d.engineLoadPct = 18 + Math.floor(t * 10);
    } else if (this.simulationProfile === PROFILE_CITY) {
      d.speedKph = 20 + Math.floor(t * 30);
      d.rpm = 1500 + Math.floor(t * 800);
      d.engineLoadPct = 25 + Math.floor(t * 30);
      d.coolantC = 85 + Math.floor(t * 10);
    } else {
      d.speedKph = 80 + Math.floor(t * 40);
      d.rpm = 2500 + Math.floor(t * 500);
      d.engineLoadPct = 40 + Math.floor(t * 20);
      d.coolantC = 88 + Math.floor(t * 8);
    }
    d.speedKph = Math.max(0, Math.min(255, d.speedKph));
    d.rpm = Math.max(0, Math.min(16383, d.rpm));
    d.engineLoadPct = Math.max(0, Math.min(100, d.engineLoadPct));
    d.coolantC = Math.max(-40, Math.min(215, d.coolantC));
  }
}

const engine = new ObdEngine();

/**
 * Para CAN ISO-TP (obd-can-responder): respuesta OBD a partir del payload completo de la peticion.
 * requestBuf: Buffer con payload OBD (ej. [0x01, 0x0C] para modo 01 PID 0C).
 * @returns {Buffer|null} bytes de la respuesta (ej. 41 0C xx xx) o null.
 */
function getObdResponseHex(requestBuf) {
  if (!requestBuf || requestBuf.length < 1) return null;
  const mode = requestBuf[0].toString(16).toUpperCase().padStart(2, '0');
  let cmd = mode;
  if (requestBuf.length >= 2) cmd += requestBuf[1].toString(16).toUpperCase().padStart(2, '0');
  if (requestBuf.length >= 3) cmd += requestBuf[2].toString(16).toUpperCase().padStart(2, '0');
  let payload = '';
  if (cmd.startsWith('01')) payload = engine.buildMode01Response(cmd);
  else if (cmd.startsWith('02')) {
    const pidHex = requestBuf.length >= 2 ? requestBuf[1].toString(16).toUpperCase().padStart(2, '0') : '';
    const frameNum = requestBuf.length >= 3 ? requestBuf[2] : 1;
    payload = engine.buildMode02Response(pidHex, frameNum);
  } else if (cmd.startsWith('09')) {
    const pidHex = requestBuf.length >= 2 ? requestBuf[1].toString(16).toUpperCase().padStart(2, '0') : '';
    const frameNum = requestBuf.length >= 3 ? requestBuf[2] : 0;
    payload = engine.buildMode09Response(pidHex, frameNum);
  } else if (cmd === '03') payload = engine.buildMode03Response();
  else if (cmd === '07') payload = engine.buildMode07Response();
  else if (cmd === '0A') payload = engine.buildMode0AResponse();
  else if (cmd === '04') { engine.clearDtc(); payload = '44'; }
  else return null;
  if (payload === 'NO DATA') return null;
  const hexStr = payload.replace(/ /g, '');
  const buf = Buffer.alloc(hexStr.length / 2);
  for (let i = 0; i < buf.length; i++) buf[i] = parseInt(hexStr.substr(i * 2, 2), 16);
  return buf;
}

function tickInterval() {
  engine.tickSimulation();
}
let tickTimer = null;
function startSimulationTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(tickInterval, 200);
}
function stopSimulationTicker() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

module.exports = {
  engine,
  getObdResponseHex,
  getSnapshot: () => engine.getSnapshot(),
  setValues: (p) => engine.setValues(p),
  setDtc: (code, on, mode) => engine.setDtc(code, !!on, mode || 'stored'),
  clearDtc: () => engine.clearDtc(),
  getDtcJson: () => engine.getDtcJson(),
  startSimulation: (profile) => {
    engine.startSimulation(profile);
    startSimulationTicker();
  },
  stopSimulation: () => {
    engine.stopSimulation();
    stopSimulationTicker();
  },
  isSimulationEnabled: () => engine.isSimulationEnabled(),
  simulationProfile: () => engine.simulationProfile,
  setErrorSimFailPids: (pids) => engine.setErrorSimFailPids(pids),
  setErrorSimNoise: (p) => engine.setErrorSimNoise(p),
  getErrorSimConfig: () => engine.getErrorSimConfig(),
  setVehicleInfo: (vin, calid, cvn) => engine.setVehicleInfo(vin, calid, cvn),
  getEngine: () => engine,
  PROFILE_IDLE,
  PROFILE_CITY,
  PROFILE_HIGHWAY,
};
