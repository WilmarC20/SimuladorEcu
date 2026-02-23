'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');
const TORQUE_LOGS_DIR = path.join(DATA_DIR, 'torque-logs');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/** POST /api/torque-import — guardar archivos seleccionados del ZIP de Torque */
router.post('/', (req, res) => {
  const { files } = req.body || {};
  if (!Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ ok: false, error: 'No se enviaron archivos' });
  }
  const maxFiles = 500;
  const maxSize = 5 * 1024 * 1024; // 5 MB por archivo
  let totalSize = 0;
  try {
    ensureDir(DATA_DIR);
    ensureDir(TORQUE_LOGS_DIR);
    const saved = [];
    const errors = [];
    for (const entry of files.slice(0, maxFiles)) {
      const relPath = (entry.path || entry.name || '').trim().replace(/^\/+/, '').replace(/\.\./g, '');
      if (!relPath) continue;
      const content = entry.content != null ? String(entry.content) : '';
      if (content.length > maxSize) {
        errors.push({ path: relPath, error: 'Archivo demasiado grande' });
        continue;
      }
      totalSize += content.length;
      const fullPath = path.join(TORQUE_LOGS_DIR, relPath);
      const dir = path.dirname(fullPath);
      ensureDir(dir);
      fs.writeFileSync(fullPath, content, 'utf8');
      saved.push(relPath);
    }
    res.json({ ok: true, saved, errors });
  } catch (err) {
    console.error('POST /api/torque-import error:', err);
    res.status(500).json({ ok: false, error: (err && err.message) || 'Error al importar' });
  }
});

/** GET /api/torque-import — listar archivos ya importados (opcional) */
router.get('/', (req, res) => {
  try {
    if (!fs.existsSync(TORQUE_LOGS_DIR)) {
      return res.json({ files: [] });
    }
    const list = [];
    function walk(dir, base = '') {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        const rel = base ? base + '/' + e.name : e.name;
        if (e.isDirectory()) {
          walk(path.join(dir, e.name), rel);
        } else {
          list.push(rel);
        }
      }
    }
    walk(TORQUE_LOGS_DIR);
    res.json({ files: list });
  } catch (err) {
    console.error('GET /api/torque-import error:', err);
    res.status(500).json({ files: [], error: (err && err.message) || 'Error' });
  }
});

module.exports = router;
