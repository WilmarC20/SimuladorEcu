'use strict';

const { getEngine } = require('./obd-engine');

// Estado del parser ELM327 (como Tracker360): echo, linefeed, spaces, headers
let echo = true;
let linefeed = false;
let spaces = true;
let headers = false;

function normalize(raw) {
  return String(raw)
    .replace(/[\r\n\t\s]/g, '')
    .toUpperCase();
}

function formatResponse(cmd, payload) {
  const eol = linefeed ? '\r\n' : '\r';
  let out = '';
  if (echo && cmd.length > 0) out += cmd + eol;
  if (payload.length > 0) out += payload + eol;
  out += '>';
  return out;
}

/**
 * Procesa un comando ELM327/OBD y devuelve la respuesta en texto.
 * @param {string} rawInput - Comando (ej. ATZ, 010C)
 * @returns {string} Respuesta terminada en >
 */
function processCommand(rawInput) {
  const cmd = normalize(rawInput);
  const engine = getEngine();

  if (cmd.length === 0) return formatResponse('', '');

  if (cmd === 'ATZ' || cmd === 'ATWS') {
    echo = true;
    linefeed = false;
    spaces = true;
    headers = false;
    return formatResponse(cmd, 'ELM327 v1.5');
  }
  if (cmd === 'ATD') return formatResponse(cmd, 'OK');
  if (cmd === 'ATI' || cmd === 'ATI1') return formatResponse(cmd, 'ELM327 v1.5');
  if (cmd === 'AT@1') return formatResponse(cmd, 'Raspberry Pi OBD2 Simulator');
  if (cmd === 'ATDP') return formatResponse(cmd, 'AUTO,ISO 15765-4 (CAN 11/500)');
  if (cmd === 'ATDPN') return formatResponse(cmd, 'A0');
  if (cmd.startsWith('ATSP')) return formatResponse(cmd, 'OK');
  if (cmd === 'ATE0') { echo = false; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATE1') { echo = true; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATL0') { linefeed = false; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATL1') { linefeed = true; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATM0' || cmd === 'ATM1') return formatResponse(cmd, 'OK');
  if (cmd === 'ATS0') { spaces = false; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATS1') { spaces = true; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATH0') { headers = false; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATH1') { headers = true; return formatResponse(cmd, 'OK'); }
  if (cmd === 'ATRV') return formatResponse(cmd, engine.getBatteryVoltageText());
  if (cmd.startsWith('ATST')) return formatResponse(cmd, 'OK');
  if (cmd.startsWith('ATAT')) return formatResponse(cmd, 'OK');

  let payload = '';
  if (cmd.startsWith('01')) payload = engine.buildMode01Response(cmd);
  else if (cmd.startsWith('02')) {
    const pidHex = cmd.length >= 4 ? cmd.slice(2, 4) : '';
    const frameNum = cmd.length >= 6 ? parseInt(cmd.slice(4, 6), 16) : 1;
    payload = engine.buildMode02Response(pidHex, frameNum);
  } else if (cmd === '03') payload = engine.buildMode03Response();
  else if (cmd === '07') payload = engine.buildMode07Response();
  else if (cmd === '0A') payload = engine.buildMode0AResponse();
  else if (cmd.startsWith('09')) {
    const pidHex = cmd.length >= 4 ? cmd.slice(2, 4) : '00';
    const frameNum = cmd.length >= 6 ? parseInt(cmd.slice(4, 6), 16) : 0;
    payload = engine.buildMode09Response(pidHex, frameNum);
  } else if (cmd === '04') {
    engine.clearDtc();
    payload = '44';
  } else {
    payload = '?';
  }
  if (headers && (cmd.startsWith('01') || cmd.startsWith('02') || cmd.startsWith('09') || cmd === '03' || cmd === '07' || cmd === '0A')) {
    payload = '7E8 ' + payload;
  }
  if (!spaces) payload = payload.replace(/ /g, '');
  return formatResponse(cmd, payload);
}

module.exports = { processCommand, normalize };
