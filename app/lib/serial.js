'use strict';

const fs = require('fs');

const UART_PATHS = ['/dev/ttyS0', '/dev/ttyAMA0', '/dev/serial0', '/dev/serial1'];

/**
 * Añade puertos UART de la Pi a la lista si existen y no están ya.
 * @param {Array<{ path: string, manufacturer?: string }>} list - Lista mutable a la que se añaden
 */
function addUartPorts(list) {
  for (const p of UART_PATHS) {
    if (fs.existsSync(p) && !list.find(s => s.path === p)) {
      list.push({ path: p, manufacturer: 'Raspberry Pi UART', vendorId: null, productId: null });
    }
  }
}

/**
 * Lista puertos serial disponibles (SerialPort.list + UART de la Pi).
 * @param {object} SerialPortModule - Módulo serialport (puede ser null)
 * @returns {Promise<Array<{ path: string, manufacturer?: string, vendorId?: string, productId?: string }>>}
 */
async function listPorts(SerialPortModule) {
  const result = [];
  if (SerialPortModule) {
    try {
      const ports = await SerialPortModule.list();
      ports.forEach(p => {
        result.push({
          path: p.path,
          manufacturer: p.manufacturer || '',
          vendorId: p.vendorId,
          productId: p.productId,
        });
      });
    } catch (e) {}
  }
  addUartPorts(result);
  return result;
}

module.exports = { addUartPorts, listPorts, UART_PATHS };
