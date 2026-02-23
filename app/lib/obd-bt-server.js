'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { processCommand } = require('./obd-command');
const { addConnection, removeConnection, logExchange, formatAddress } = require('./obd-connection-logger');

let BTServer = null;
let loadError = null;
try {
  const btp = require('bluetooth-serial-port');
  BTServer = btp.BluetoothSerialPortServer;
  if (process.platform === 'linux' && !BTServer) {
    loadError = 'El paquete no exporta BluetoothSerialPortServer en este sistema.';
  }
} catch (e) {
  loadError = e && (e.message || String(e)) || 'Error al cargar bluetooth-serial-port';
  if (e && e.code === 'MODULE_NOT_FOUND') {
    loadError = 'Módulo no instalado (Node 20 no compatible). Se usará puente Python si está disponible.';
  } else if (e && (e.message || '').includes('node-gyp') || (e.message || '').includes('gyp')) {
    loadError = 'Módulo no compila con Node 20. Se usará puente Python si está disponible.';
  }
}

const btServerState = {
  available: false,
  listening: false,
  connected: false,
  error: null,
  usePythonBridge: false,
};

let bridgeProcess = null;

/**
 * Inicia el puente Python (PyBluez). Pasa OBD_BT_HCI si está definido (ej. hci1 = dongle).
 */
function startPythonBridge(tcpPort) {
  const scriptPath = path.join(__dirname, '..', 'scripts', 'obd_bt_bridge.py');
  const env = { ...process.env };
  if (process.env.OBD_BT_HCI) env.OBD_BT_HCI = process.env.OBD_BT_HCI;
  if (process.env.OBD_BT_RFCOMM_CHANNEL) env.OBD_BT_RFCOMM_CHANNEL = process.env.OBD_BT_RFCOMM_CHANNEL;
  const child = spawn('python3', [scriptPath, String(tcpPort)], {
    cwd: path.join(__dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += d.toString();
    const line = d.toString().trim();
    if (line) console.error('OBD2 BT bridge:', line);
  });
  child.stdout.on('data', (d) => {
    const line = d.toString().trim();
    if (line) console.log('OBD2 BT bridge:', line);
  });
  child.on('error', (err) => {
    btServerState.listening = false;
    btServerState.error = 'No se pudo iniciar el puente Python: ' + (err.message || err);
    btServerState.usePythonBridge = false;
    console.error('OBD2 BT bridge error:', err.message);
  });
  child.on('exit', (code, signal) => {
    bridgeProcess = null;
    btServerState.listening = false;
    btServerState.connected = false;
    btServerState.usePythonBridge = false;
    if (code !== 0 && code !== null) {
      btServerState.error = stderr.trim() || 'Puente Python terminó (code ' + code + '). ¿PyBluez instalado? sudo apt install python3-bluez';
    }
  });
  bridgeProcess = child;
  btServerState.available = true;
  btServerState.listening = true;
  btServerState.error = null;
  btServerState.usePythonBridge = true;
  console.log('OBD2 BT (Torque): puente Python activo. RFCOMM → 127.0.0.1:' + tcpPort + '. En Torque elige este dispositivo (nombre de la Pi).');
  return child;
}

/**
 * Servidor Bluetooth SPP (RFCOMM): para cuando Torque se conecta directo a la Pi por BT (sin ELM).
 * Si usas Torque → ELM327 → hembra OBD → Pi, el tráfico va por CAN y obd-can-responder responde por CAN; este servidor BT no interviene.
 */
function startObdBtServer(tcpPort) {
  const port = tcpPort || 35000;

  if (BTServer && process.platform === 'linux') {
    btServerState.available = true;
    const server = new BTServer();
    let buffer = '';
    let btConnId = null;
    const LINE_END = '\r';

    function writeToClient(str) {
      server.write(Buffer.from(str, 'utf8'), (err) => {
        if (err) console.error('OBD2 BT write:', err.message);
      });
    }

    server.on('data', (data) => {
      buffer += (data && data.toString ? data.toString('utf8') : '') || '';
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.replace(/\s+$/, '').trim();
        if (trimmed.length === 0) continue;
        let response;
        try {
          response = processCommand(trimmed);
          writeToClient(response + LINE_END);
        } catch (e) {
          response = trimmed + '\r?\r>' + LINE_END;
          writeToClient(response);
        }
        if (btConnId) logExchange(btConnId, trimmed, response);
      }
    });

    server.on('closed', () => {
      if (btConnId) removeConnection(btConnId);
      btConnId = null;
      buffer = '';
      btServerState.connected = false;
    });

    server.on('disconnected', () => {
      if (btConnId) removeConnection(btConnId);
      btConnId = null;
      buffer = '';
      btServerState.connected = false;
    });

    server.on('failure', (err) => {
      btServerState.listening = false;
      btServerState.error = err && err.message ? err.message : String(err);
      console.error('OBD2 BT failure:', btServerState.error);
    });

    server.listen(
      (clientAddress) => {
        buffer = '';
        btServerState.connected = true;
        const mac = formatAddress(clientAddress);
        btConnId = addConnection('bt-' + mac, 'bt', mac, mac);
        console.log('OBD2 BT: cliente conectado', mac);
      },
      (err) => {
        btServerState.listening = false;
        btServerState.error = err && err.message ? err.message : String(err);
        console.error('OBD2 BT server error:', btServerState.error);
      },
      { channel: 1 }
    );

    btServerState.listening = true;
    btServerState.error = null;
    console.log('OBD2 BT (Torque): servidor SPP activo. En Torque elige este dispositivo (nombre de la Pi).');
    return server;
  }

  if (process.platform === 'linux') {
    return startPythonBridge(port);
  }

  btServerState.error = loadError || 'Bluetooth OBD solo disponible en Linux.';
  return null;
}

function getBtServerState() {
  return { ...btServerState };
}

module.exports = { startObdBtServer, getBtServerState };
