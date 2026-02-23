'use strict';

/**
 * Emulador OBD2 por CAN para Torque (SocketCAN / raw frames).
 * Requests: 7DF 02 01 XX 00... (11-bit) y 18DB33F1 02 01 XX 00... (29-bit). Padding ignorado.
 * Respuestas: 7DF → 7E8 (11-bit); 18DB33F1 → 18DAF100 (29-bit, extended/CAN_EFF_FLAG).
 * Solo servicio 0x01: 01 00 → PIDs soportados (06 41 00 1D B0 00 00); 01 0C → RPM (04 41 0C xx xx); 01 0D → velocidad (03 41 0D xx).
 * Formato ISO-TP Single Frame: byte0 = longitud, byte1 = 0x41, byte2 = PID, resto = datos.
 */
const { getObdResponseHex } = require('./obd-engine');
const { spawn, execSync } = require('child_process');
const { addConnection, logExchange } = require('./obd-connection-logger');

const OBD_REQUEST_ID_7E0 = 0x7e0;
const OBD_REQUEST_ID_7DF = 0x7df;
const OBD_RESPONSE_ID_11BIT = 0x7e8;
const OBD_REQUEST_ID_29BIT = 0x18db33f1;
const OBD_RESPONSE_ID_29BIT = 0x18daf100;
const CAN_ID_11BIT_MAX = 0x7ff;

/** Si está definido, solo respondemos a estos PIDs/modos (ej. 0100,010C,03). Si no, respondemos a todo lo que el motor soporta. */
const PIDS_ALLOWED_CFG = process.env.OBD_PIDS_ALLOWED ? process.env.OBD_PIDS_ALLOWED.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null;

/** OBD_11BIT_ONLY=1: no responder a 18DB33F1 (solo 7E0/7DF→7E8). Si no, también respondemos 18DB33F1→18DAF100. */
const RESPOND_29BIT = process.env.OBD_11BIT_ONLY !== '1' && process.env.OBD_11BIT_ONLY !== 'true';

/** Por defecto SÍ enviamos por CAN (ELM en hembra OBD). OBD_CAN_TX_DISABLE=1 para no enviar (Torque directo a Pi por BT). */
const CAN_TX_DISABLED = process.env.OBD_CAN_TX_DISABLE === '1' || process.env.OBD_CAN_TX_DISABLE === 'true';
const DEBOUNCE_MS = Math.max(50, Math.min(500, parseInt(process.env.OBD_DEBOUNCE_MS, 10) || 120));
const CAN_STATE_LOG_INTERVAL_MS = Math.max(2000, parseInt(process.env.OBD_CAN_STATE_INTERVAL_MS, 10) || 5000);

/** Delay (ms) antes de enviar la respuesta. Configurable por env OBD_RESPONSE_DELAY_MS (10–30 recomendado). */
const RESPONSE_DELAY_MS = Math.max(10, Math.min(100, parseInt(process.env.OBD_RESPONSE_DELAY_MS, 10) || 20));

function toBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return Buffer.from(value);
  if (typeof value === 'string') {
    const h = value.replace(/\s+/g, '');
    if (!h || h.length % 2 !== 0) return null;
    return Buffer.from(h, 'hex');
  }
  return null;
}

function hex(buf) {
  return buf.toString('hex').toUpperCase().replace(/(..)/g, '$1 ').trim();
}

function parseCanId(rawId) {
  const s = (rawId || '').trim();
  if (!s) return null;
  const v = parseInt(s, 16);
  return Number.isFinite(v) ? (v >>> 0) : null;
}

function parseCandumpLine(line) {
  const s = (line || '').trim();
  if (!s) return null;
  const m = s.match(/^(?:\([^)]+\)\s+)?([^\s]+)\s+([0-9A-Fa-f]+)\s+\[(\d+)\]\s+(.+)$/);
  if (!m) return null;
  const id = parseCanId(m[2]);
  const len = parseInt(m[3], 10);
  if (id == null || !Number.isFinite(len) || len < 0) return null;
  const bytes = m[4].trim().split(/\s+/).slice(0, len).map((h) => parseInt(h, 16));
  if (bytes.length !== len || bytes.some((b) => !Number.isFinite(b) || b < 0 || b > 255)) return null;
  return { id, data: Buffer.from(bytes) };
}

function extractObdPayloadFromSingleFrame(canData) {
  if (!canData || canData.length < 2) return null;
  const pci = canData[0];
  if (((pci >> 4) & 0x0f) !== 0x0) return null;
  const pduLen = pci & 0x0f;
  if (pduLen < 1 || pduLen > 7 || canData.length < 1 + pduLen) return null;
  return Buffer.from(canData.slice(1, 1 + pduLen));
}

/**
 * Construye un frame ISO-TP Single Frame para CAN (ISO 15765-4).
 * Byte 0 = PCI: 0x0N con N = número de bytes de datos (1..7). Bytes 1..N = datos.
 * Enviamos solo PCI + datos (sin relleno a 8); el driver usa DLC = frame.length (7 para 6 bytes de datos).
 * Ejemplo: payload 6 bytes (41 00 1D B0 00 00) -> [06 41 00 1D B0 00 00] (7 bytes, DLC=7).
 */
function buildSingleFrame(payload) {
  const len = payload.length;
  if (len < 1 || len > 7) return null;
  const frame = Buffer.alloc(1 + len);
  frame[0] = len;  // PCI: Single Frame (0x0), length = len
  payload.copy(frame, 1);
  return frame;
}

/**
 * 7E0/7DF → 7E8 (11-bit). 18DB33F1 → 18DAF100 (29-bit) si RESPOND_29BIT; si no, solo 11-bit (OBD_11BIT_ONLY=1).
 */
function getResponseInfo(requestId) {
  if (requestId === OBD_REQUEST_ID_7E0 || requestId === OBD_REQUEST_ID_7DF)
    return { responseId: OBD_RESPONSE_ID_11BIT, ext: false };
  if (RESPOND_29BIT && requestId === OBD_REQUEST_ID_29BIT)
    return { responseId: OBD_RESPONSE_ID_29BIT, ext: true };
  return null;
}

/**
 * Normaliza payload OBD: 1 byte (ej. 03) = solo modo; 2 bytes = (mode, PID); 3+ con [0]=longitud → datos.
 */
function normalizeRequestPayload(requestPayload) {
  if (!requestPayload || requestPayload.length < 1) return null;
  if (requestPayload.length === 1) return requestPayload;
  if (requestPayload.length === 2) return requestPayload;
  const len = requestPayload[0];
  if (len >= 1 && len <= 7 && requestPayload.length >= 1 + len) {
    return requestPayload.slice(1, 1 + len);
  }
  return requestPayload.slice(0, 2);
}

/** Obtiene cmd "0100" o "03" desde payload normalizado (1 byte = modo; 2 = mode+PID). */
function getObdCmdFromPayload(normalizedPayload) {
  if (!normalizedPayload || normalizedPayload.length < 1) return null;
  const m = normalizedPayload[0].toString(16).padStart(2, '0').toUpperCase();
  if (normalizedPayload.length === 1) return m;
  const p = normalizedPayload[1].toString(16).padStart(2, '0').toUpperCase();
  return m + p;
}

/** Lee estado del bus CAN para diagnóstico (error-passive, bus-off, contadores). */
function getCanBusState(iface) {
  try {
    const out = execSync('ip -details link show ' + iface, { encoding: 'utf8', timeout: 1000 });
    const ifState = (out.match(/\bstate\s+(\S+)/i) || [])[1] || '';
    const canState = (out.match(/can\s+state\s+([^\s(]+)/i) || [])[1] || '';
    const berr = out.match(/berr-counter\s+tx\s+(\d+)\s+rx\s+(\d+)/i) || out.match(/tx\s+(\d+)\s+rx\s+(\d+)/);
    const txErr = berr ? parseInt(berr[1], 10) : null;
    const rxErr = berr ? parseInt(berr[2], 10) : null;
    const restarts = (out.match(/re-started/i) ? 1 : 0);
    return { ifState: ifState.toUpperCase(), canState: (canState || ifState).toUpperCase(), txErrors: txErr, rxErrors: rxErr, restarts };
  } catch (e) {
    return { ifState: 'DOWN', canState: 'DOWN', error: (e && e.message) || String(e) };
  }
}

function enableOneShotMode(iface) {
  if (process.env.OBD_SKIP_ONE_SHOT === '1' || process.env.OBD_SKIP_ONE_SHOT === 'true') {
    console.log('OBD CAN: one-shot omitido (OBD_SKIP_ONE_SHOT). No se toca can0 al arrancar; candump externo no se cierra.');
    return false;
  }
  try {
    execSync('ip link set ' + iface + ' down', { stdio: 'pipe', timeout: 2000 });
    execSync('ip link set ' + iface + ' type can bitrate 500000 one-shot on', { stdio: 'pipe', timeout: 2000 });
    execSync('ip link set ' + iface + ' up', { stdio: 'pipe', timeout: 2000 });
    console.log('OBD CAN: ' + iface + ' one-shot on (evita BUS-OFF si no hay ACK).');
    return true;
  } catch (e) {
    try {
      execSync('ip link set ' + iface + ' up type can bitrate 500000', { stdio: 'pipe', timeout: 2000 });
    } catch (_) {}
    const msg = (e && e.message) ? e.message : String(e);
    console.warn('OBD CAN: one-shot no disponible:', msg);
    if (msg.includes('Operation not permitted') || msg.includes('RTNETLINK')) {
      console.warn('OBD CAN: ejecuta con sudo para activar one-shot y evitar BUS-OFF: sudo -E OBD_USE_RAW=1 node app/index.js');
    }
    return false;
  }
}

function startWithRawCanTx(iface) {
  let can;
  try {
    can = require('socketcan');
  } catch (e) {
    console.warn('OBD CAN responder: socketcan no disponible:', e.message);
    return null;
  }

  enableOneShotMode(iface);

  let txChannel = null;
  try {
    txChannel = can.createRawChannelWithOptions(iface, { timestamps: false, non_block_send: true });
  } catch (e) {
    console.warn('OBD CAN responder: no se pudo crear canal raw TX:', e.message);
    return null;
  }

  addConnection('can0', 'can', iface, 'Puerto OBD (CAN)');

  const candumpProc = spawn('candump', [iface], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdoutBuf = '';
  let stopped = false;
  let lastRequestKey = '';
  let lastRequestTime = 0;
  let txPausedBecauseBusOff = false;
  let busOffSuggestionLogged = false;
  let lastCanState = '';
  let lastCanStateLogTime = 0;
  const CAN_STATE_REPEAT_MS = 30000;

  function doSendSingleFrame(payload, responseId, ext) {
    const buf = toBuffer(payload);
    if (!buf || buf.length === 0) return;
    if (buf.length > 7) {
      console.warn('OBD CAN: respuesta >7 bytes, solo Single Frame; omitiendo TX.');
      return;
    }
    const frame = buildSingleFrame(buf);
    if (!frame || frame.length !== 1 + buf.length || frame[0] !== buf.length) {
      console.warn('OBD CAN: frame ISO-TP inválido (PCI+payload); omitiendo TX.');
      return;
    }

    const idStr = responseId.toString(16).toUpperCase();
    if (CAN_TX_DISABLED) {
      console.log('TX (deshabilitado): ' + idStr + ' ' + hex(frame));
      return;
    }
    if (txPausedBecauseBusOff) {
      console.log('TX (pausado, bus BUS-OFF): ' + idStr + ' ' + hex(frame));
      return;
    }
    console.log('TX: ' + idStr + ' [' + frame.length + '] ' + hex(frame));
    try {
      txChannel.send({ id: responseId, data: frame, ext: !!ext });
    } catch (e) {
      console.error('OBD CAN send error:', e && e.message ? e.message : e);
    }
  }

  candumpProc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop() || '';
    lines.forEach((line) => {
      const raw = line.trim();
      if (!raw) return;
      const parsed = parseCandumpLine(line);
      if (!parsed) {
        if (process.env.OBD_DEBUG) console.log('OBD CAN: línea no parseada:', raw.slice(0, 80));
        return;
      }
      const responseInfo = getResponseInfo(parsed.id);
      if (!responseInfo) {
        const idHex = parsed.id.toString(16).toUpperCase();
        console.log('OBD CAN: RX ' + idHex + ' (ignorado) ' + hex(parsed.data));
        return;
      }
      const requestPayload = extractObdPayloadFromSingleFrame(parsed.data);
      if (!requestPayload || requestPayload.length === 0) {
        const idHex = parsed.id.toString(16).toUpperCase();
        console.log('OBD CAN: RX ' + idHex + ' (no Single Frame ISO-TP) ' + hex(parsed.data));
        return;
      }

      const normalized = normalizeRequestPayload(requestPayload);
      if (!normalized || normalized.length < 1) {
        console.log('OBD CAN: RX ' + parsed.id.toString(16).toUpperCase() + ' (payload vacío) ' + hex(requestPayload));
        return;
      }

      if (normalized[0] !== 0x01) return;

      const cmd = getObdCmdFromPayload(normalized);
      if (!cmd) return;
      if (PIDS_ALLOWED_CFG && !PIDS_ALLOWED_CFG.includes(cmd)) {
        console.log('OBD CAN: RX ' + parsed.id.toString(16).toUpperCase() + ' ' + cmd + ' (omitido por OBD_PIDS_ALLOWED)');
        return;
      }

      const requestKey = parsed.id + '-' + parsed.data.toString('hex');
      const now = Date.now();
      if (requestKey === lastRequestKey && now - lastRequestTime < DEBOUNCE_MS) {
        return; // una sola respuesta por petición; ignorar duplicados
      }
      lastRequestKey = requestKey;
      lastRequestTime = now;

      const idHex = parsed.id.toString(16).toUpperCase();
      console.log('RX: ' + idHex + ' ' + hex(requestPayload) + ' → ' + cmd);

      const responsePayload = getObdResponseHex(normalized);
      if (!responsePayload || responsePayload.length === 0) return;

      logExchange('can0', hex(requestPayload), hex(responsePayload));

      const respId = responseInfo.responseId;
      const ext = responseInfo.ext;
      setTimeout(() => {
        if (stopped) return;
        doSendSingleFrame(responsePayload, respId, ext);
      }, RESPONSE_DELAY_MS);
    });
  });

  candumpProc.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg && !stopped) console.error('OBD CAN candump:', msg);
  });
  candumpProc.on('close', (code, signal) => {
    if (!stopped) console.warn('OBD CAN candump cerrado (code=' + code + ', signal=' + signal + ').');
  });

  try {
    txChannel.start();
  } catch (e) {
    console.warn('OBD CAN responder: no se pudo iniciar canal TX:', e.message);
    return null;
  }

  const BUS_OFF_SUGGESTION = 'Sugerencia: sudo -E OBD_USE_RAW=1 node app/index.js (one-shot), terminación 120Ω en el bus, o OBD_CAN_TX_DISABLE=1. Reiniciar can0: sudo ip link set can0 down && sudo ip link set can0 up type can bitrate 500000';

  const logCanState = () => {
    if (stopped) return;
    const s = getCanBusState(iface);
    const isBusOff = s.canState && s.canState.includes('BUS-OFF');
    const isErrorPassive = s.canState && s.canState.includes('ERROR-PASSIVE');
    const bad = isBusOff || isErrorPassive || (s.canState && s.canState.includes('ERROR-WARNING')) || (s.txErrors != null && s.txErrors > 0) || (s.rxErrors != null && s.rxErrors > 0);
    if (isBusOff) txPausedBecauseBusOff = true;
    const stateStr = (s.canState || s.ifState) || '';
    const msg = 'CAN ' + iface + ': state=' + stateStr + (s.txErrors != null ? ' txErr=' + s.txErrors : '') + (s.rxErrors != null ? ' rxErr=' + s.rxErrors : '') + (s.error ? ' ' + s.error : '');
    const now = Date.now();
    const stateChanged = stateStr !== lastCanState;
    const repeatOk = !lastCanStateLogTime || now - lastCanStateLogTime >= CAN_STATE_REPEAT_MS;
    if (bad && (stateChanged || repeatOk)) {
      console.warn('OBD CAN: ' + msg);
      lastCanState = stateStr;
      lastCanStateLogTime = now;
    } else if (!bad && process.env.OBD_CAN_STATE_VERBOSE) console.log('OBD CAN: ' + msg);
    if ((isBusOff || isErrorPassive) && !busOffSuggestionLogged) {
      busOffSuggestionLogged = true;
      console.warn('OBD CAN: ' + BUS_OFF_SUGGESTION);
    }
  };

  logCanState();
  const stateInterval = setInterval(logCanState, CAN_STATE_LOG_INTERVAL_MS);

  if (CAN_TX_DISABLED) {
    console.log('OBD CAN: TX por CAN deshabilitado (OBD_CAN_TX_DISABLE). Solo para Torque directo a Pi por BT; con ELM en hembra no usar.');
  }
  const idInfo = RESPOND_29BIT ? '7E0/7DF->7E8, 18DB33F1->18DAF100' : 'solo 7E0/7DF->7E8 11-bit';
  const pidInfo = PIDS_ALLOWED_CFG ? 'PIDs: ' + PIDS_ALLOWED_CFG.join(',') : 'todos los soportados (01xx,03,07,0A,04)';
  console.log('OBD CAN responder activo en ' + iface + ' (' + idInfo + '; ' + pidInfo + '; delay ' + RESPONSE_DELAY_MS + ' ms).');
  console.log('OBD CAN: escuchando candump en ' + iface + '. Estado del bus cada ' + (CAN_STATE_LOG_INTERVAL_MS / 1000) + ' s si hay errores.');

  return {
    stop: () => {
      stopped = true;
      clearInterval(stateInterval);
      try { candumpProc.kill('SIGTERM'); } catch (_) {}
      try { if (txChannel && typeof txChannel.stop === 'function') txChannel.stop(); } catch (_) {}
    },
  };
}

function startObdCanResponder(iface) {
  let can;
  try {
    can = require('socketcan');
  } catch (e) {
    console.warn('OBD CAN responder: socketcan no disponible:', e.message);
    return null;
  }

  const useRaw = process.env.OBD_USE_RAW === '1' || process.env.OBD_USE_RAW === 'true';
  if (!useRaw && typeof can.createIsoTpChannel === 'function') {
    try {
      const channel = can.createIsoTpChannel(iface, OBD_REQUEST_ID_7E0, OBD_RESPONSE_ID_11BIT);
      channel.addListener('onMessage', (msg) => {
        try {
          const req = toBuffer(msg && msg.data ? msg.data : msg);
          if (!req || req.length === 0) return;
          const rxId = (msg && typeof msg.id === 'number') ? msg.id : OBD_REQUEST_ID_7E0;
          console.log('RX: ' + rxId.toString(16).toUpperCase() + ' ' + hex(req));
          const resp = getObdResponseHex(req);
          if (!resp || resp.length === 0) return;
          const tx = toBuffer(resp);
          if (!tx || tx.length === 0) return;
          setTimeout(() => {
            try {
              console.log('TX: ' + hex(tx));
              channel.send(tx);
            } catch (e) {
              console.error('OBD CAN send error:', e && e.message ? e.message : e);
            }
          }, RESPONSE_DELAY_MS);
        } catch (e) {
          console.error('OBD ISOTP responder:', e.message);
        }
      });
      channel.addListener('onError', (e) => console.error('OBD ISOTP error:', e && e.message ? e.message : e));
      channel.start();
      console.log('OBD ISOTP responder activo en ' + iface + ' (delay ' + RESPONSE_DELAY_MS + ' ms).');
      return channel;
    } catch (e) {
      console.warn('OBD CAN responder: createIsoTpChannel falló:', e.message);
    }
  }

  return startWithRawCanTx(iface);
}

module.exports = { startObdCanResponder, RESPONSE_DELAY_MS };
