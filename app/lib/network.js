'use strict';

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

/**
 * Obtiene información de red (WiFi y Bluetooth) para la Raspberry Pi.
 * @returns {{ wifi: { name: string, mac: string } | null, bt: { name: string, mac: string } | null }}
 */
function getNetworkInfo() {
  const result = { wifi: null, bt: null };

  try {
    const netDir = path.join('/sys/class/net');
    const ifaces = fs.readdirSync(netDir);
    const wlan = ifaces.find(n => n.startsWith('wlan') || n.startsWith('wlp'));
    if (wlan) {
      const macPath = path.join(netDir, wlan, 'address');
      if (fs.existsSync(macPath)) {
        const mac = fs.readFileSync(macPath, 'utf8').trim().toLowerCase();
        result.wifi = { name: wlan, mac };
      }
    }
  } catch (e) {
    // ignore
  }

  try {
    const list = getBluetoothAdapters();
    if (list.length === 1) result.bt = list[0];
    else if (list.length > 1) {
      result.bt = {
        name: list.map(b => b.name).join(', '),
        mac: list.map(b => b.mac).join(', '),
      };
    }
  } catch (e) {
    // ignore
  }

  return result;
}

/**
 * Detecta si el adaptador es Bluetooth Clásico (BR/EDR) según la salida de hciconfig.
 * Type: "BR/EDR" o "BR/EDR  LE" = Clásico (y a veces también BLE). Type: "LE" = solo BLE.
 * @param {string} out - Salida de hciconfig -a
 * @returns {boolean|null} true = Clásico, false = solo BLE, null = desconocido
 */
function parseHciType(out) {
  if (!out || typeof out !== 'string') return null;
  const typeMatch = out.match(/Type:\s*([^\n]+)/);
  if (!typeMatch) return null;
  const type = typeMatch[1].trim();
  if (/BR\/EDR/.test(type)) return true;  // Clásico (o dual)
  if (/^\s*LE\s*$/.test(type) || type === 'LE') return false;  // solo BLE
  return null;
}

/**
 * Lista adaptadores Bluetooth (hci0, hci1, …) con nombre, MAC y si es Clásico (BR/EDR).
 * @returns {Array<{ name: string, mac: string, classic: boolean|null }>}
 */
function getBluetoothAdapters() {
  const list = [];
  try {
    const btDir = '/sys/class/bluetooth';
    if (!fs.existsSync(btDir)) return list;
    const adapters = fs.readdirSync(btDir).filter(n => n.startsWith('hci'));
    adapters.sort();
    for (const name of adapters) {
      let mac = null;
      let classic = null;
      const macPath = path.join(btDir, name, 'address');
      if (fs.existsSync(macPath)) {
        mac = fs.readFileSync(macPath, 'utf8').trim().toLowerCase();
      }
      try {
        const out = execSync('hciconfig ' + name + ' -a 2>/dev/null', {
          encoding: 'utf8',
          timeout: 800,
        });
        if (!mac) {
          const m = out.match(/BD Address:\s*([0-9A-Fa-f:]{17})/);
          if (m) mac = m[1].toLowerCase();
        }
        classic = parseHciType(out);
      } catch (_) {}
      if (mac) list.push({ name, mac, classic });
    }
  } catch (e) {}
  return list;
}

module.exports = { getNetworkInfo, getBluetoothAdapters };
