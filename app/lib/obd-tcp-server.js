'use strict';

const net = require('net');
const { processCommand } = require('./obd-command');
const { addConnection, removeConnection, logExchange } = require('./obd-connection-logger');

/**
 * Servidor TCP (p. ej. 35000): para puente Python cuando Torque se conecta directo a la Pi por BT.
 * Flujo típico con ELM: Torque → BT → ELM327 → CAN (hembra) → Pi; entonces obd-can-responder responde por CAN y este TCP no se usa.
 */
function startObdTcpServer(port) {
  const server = net.createServer((socket) => {
    const remote = socket.remoteAddress + ':' + socket.remotePort;
    const isLocal = socket.remoteAddress === '127.0.0.1' || socket.remoteAddress === '::ffff:127.0.0.1';
    const connId = addConnection(
      'tcp-' + remote,
      isLocal ? 'bt' : 'tcp',
      remote,
      isLocal ? 'BT (puente)' : socket.remoteAddress
    );
    socket._obdConnId = connId;
    console.log('OBD2 TCP: cliente conectado ' + remote + ' (Torque/BT bridge)');
    let buffer = '';
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    socket.write('>\r');
    socket.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      const preview = str.replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '.').slice(0, 80);
      console.log('OBD2 datos:', chunk.length, 'bytes →', preview || '(solo bytes no imprimibles)');
      buffer += str;
      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.replace(/[\x00-\x1f\x7f]/g, '').trim();
        if (trimmed.length === 0) continue;
        if (trimmed.length > 96) continue;
        console.log('OBD2 ← comando:', trimmed);
        let response;
        try {
          response = processCommand(trimmed);
          socket.write(response + '\r');
        } catch (e) {
          response = trimmed + '\r?\r>\r';
          socket.write(response);
        }
        logExchange(connId, trimmed, response);
      }
    });
    socket.on('end', () => {
      removeConnection(socket._obdConnId);
      console.log('OBD2 TCP: cliente desconectado', remote);
    });
    socket.on('error', (err) => {
      removeConnection(socket._obdConnId);
      console.error('OBD TCP client error:', err.message);
    });
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('OBD2 TCP: puerto ' + port + ' en uso. Para liberarlo: kill $(lsof -t -i:' + port + ')  o cierra la otra instancia del dashboard.');
    } else {
      console.error('OBD2 TCP server error:', err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log('OBD2 TCP (Torque WiFi): 0.0.0.0:' + port);
  });

  return server;
}

module.exports = { startObdTcpServer };
