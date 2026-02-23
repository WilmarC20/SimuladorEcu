'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const { spawnSync, spawn, execSync } = require('child_process');
const { getBluetoothAdapters } = require('../lib/network');

const router = express.Router();
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const BT_AGENT_SCRIPT = path.join(SCRIPTS_DIR, 'bt_accept_agent.py');

const startedAdapters = new Map();

function getAdapterAlias(mac) {
  try {
    const r = spawnSync('bluetoothctl', ['show', mac], { encoding: 'utf8', timeout: 3000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const m = out.match(/Alias:\s*(.+)/);
    return m ? m[1].trim() : null;
  } catch (_) {
    return null;
  }
}

router.get('/adapters', (req, res) => {
  try {
    const adapters = getBluetoothAdapters();
    res.json({ adapters });
  } catch (e) {
    res.status(500).json({ adapters: [], error: e.message });
  }
});

router.get('/started', (req, res) => {
  const list = Array.from(startedAdapters.values());
  res.json({ started: list });
});

const BT_AGENT_LOG = '/tmp/bt_accept_agent.log';

router.get('/agent-log', (req, res) => {
  try {
    const raw = fs.readFileSync(BT_AGENT_LOG, 'utf8');
    const lines = raw.trim().split('\n');
    const last = lines.slice(-30).join('\n');
    res.type('text/plain').send(last || '(vacío)');
  } catch (e) {
    if (e.code === 'ENOENT') res.type('text/plain').send('(el agente aún no ha escrito log)');
    else res.status(500).type('text/plain').send('Error: ' + e.message);
  }
});

router.post('/start', async (req, res) => {
  const { name, mac } = req.body || {};
  let adapterMac = mac;
  if (!adapterMac && name) {
    const adapters = getBluetoothAdapters();
    const found = adapters.find(a => a.name === name);
    if (found) adapterMac = found.mac;
  }
  if (!adapterMac) {
    const adapters = getBluetoothAdapters();
    const hint = adapters.length === 0
      ? ' No hay adaptadores BT. Activa el dongle: sudo ./scripts/activate-dongle.sh (en la carpeta dashboard).'
      : ' Elige un adaptador de la lista (ej. hci0 o hci1).';
    return res.status(400).json({
      ok: false,
      msg: 'Indica el adaptador (name o mac).' + hint,
    });
  }
  try {
    let agentStarted = false;
    try {
      const agentRunning = spawnSync('pgrep', ['-f', 'bt_accept_agent.py'], { encoding: 'utf8' });
      if (agentRunning.status !== 0 || !agentRunning.stdout.trim()) {
        try { execSync('pkill -f bt_accept_agent.py 2>/dev/null', { timeout: 2000 }); } catch (_) {}
        await new Promise(r => setTimeout(r, 500));
        const child = spawn('python3', [BT_AGENT_SCRIPT], {
          cwd: SCRIPTS_DIR,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        agentStarted = true;
        await new Promise(r => setTimeout(r, 2500));
      }
    } catch (e) {
      console.error('BT agent start:', e.message);
    }

    const input = [
      `select ${adapterMac}`,
      'power on',
      'discoverable on',
      'pairable on',
      'quit',
    ].join('\n') + '\n';
    const result = spawnSync('bluetoothctl', [], {
      input,
      encoding: 'utf8',
      timeout: 10000,
    });
    if (result.status !== 0) {
      const out = (result.stderr || result.stdout || '').trim();
      return res.status(500).json({
        ok: false,
        msg: out || 'bluetoothctl falló. ¿Servicio bluetooth activo y usuario en grupo bluetooth?',
      });
    }

    const agentMsg = agentStarted
      ? ' Vinculación automática activa. Si el celular aún dice "Vinculación no aceptada", en la Pi revisa /tmp/bt_accept_agent.log'
      : ' Si el celular dice "Vinculación no aceptada", en la Pi: sudo apt install python3-dbus python3-gi y revisa /tmp/bt_accept_agent.log';
    const adapters = getBluetoothAdapters();
    const adapterName = name || adapters.find(a => a.mac === adapterMac)?.name || adapterMac;
    const alias = getAdapterAlias(adapterMac) || null;
    startedAdapters.set(adapterMac, { name: adapterName, mac: adapterMac, alias });
    res.json({
      ok: true,
      msg: 'Adaptador encendido y visible.' + agentMsg,
      started: Array.from(startedAdapters.values()),
    });
  } catch (e) {
    const hint = (e.message || '').includes('ENOENT')
      ? ' ¿Está instalado bluetoothctl? (apt install bluez)'
      : '';
    console.error('BT start:', e);
    res.status(500).json({
      ok: false,
      msg: (e.message || 'Error al ejecutar bluetoothctl') + hint,
    });
  }
});

router.post('/stop', (req, res) => {
  const { name, mac } = req.body || {};
  let targetMac = mac;
  if (!targetMac && name) {
    const adapters = getBluetoothAdapters();
    const found = adapters.find(a => a.name === name);
    if (found) targetMac = found.mac;
  }
  const stopAll = !targetMac;
  const toStop = stopAll ? Array.from(startedAdapters.keys()) : (startedAdapters.has(targetMac) ? [targetMac] : [targetMac].filter(Boolean));

  try {
    if (stopAll && toStop.length === 0) {
      try { execSync('pkill -f bt_accept_agent.py 2>/dev/null', { timeout: 2000 }); } catch (_) {}
      const input = ['discoverable off', 'pairable off', 'quit'].join('\n') + '\n';
      spawnSync('bluetoothctl', [], { input, encoding: 'utf8', timeout: 10000 });
      startedAdapters.clear();
      return res.json({ ok: true, msg: 'Bluetooth ya no es visible.', started: [] });
    }

    for (const m of toStop) {
      const input = [`select ${m}`, 'discoverable off', 'pairable off', 'quit'].join('\n') + '\n';
      const result = spawnSync('bluetoothctl', [], { input, encoding: 'utf8', timeout: 10000 });
      startedAdapters.delete(m);
      if (result.status !== 0 && toStop.length === 1) {
        const out = (result.stderr || result.stdout || '').trim();
        return res.status(500).json({ ok: false, msg: out || 'bluetoothctl falló' });
      }
    }
    if (stopAll && toStop.length > 0) {
      try { execSync('pkill -f bt_accept_agent.py 2>/dev/null', { timeout: 2000 }); } catch (_) {}
    }
    res.json({ ok: true, msg: toStop.length === 1 ? 'Adaptador apagado (ya no visible).' : 'Todos los adaptadores apagados.', started: Array.from(startedAdapters.values()) });
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message || 'Error al apagar visibilidad' });
  }
});

module.exports = router;
