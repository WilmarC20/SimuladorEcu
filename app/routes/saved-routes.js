'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', 'data');
const ROUTES_FILE = path.join(DATA_DIR, 'routes.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readRoutes() {
  ensureDataDir();
  if (!fs.existsSync(ROUTES_FILE)) return [];
  try {
    const data = fs.readFileSync(ROUTES_FILE, 'utf8');
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeRoutes(routes) {
  ensureDataDir();
  fs.writeFileSync(ROUTES_FILE, JSON.stringify(routes, null, 2), 'utf8');
}

/** GET /api/saved-routes — lista de rutas guardadas */
router.get('/', (req, res) => {
  try {
    const routes = readRoutes();
    res.json(routes.map((r, i) => ({
      id: r.id || String(i),
      name: r.name || 'Sin nombre',
      waypoints: r.waypoints || [],
      createdAt: r.createdAt || null,
    })));
  } catch (err) {
    console.error('GET /api/saved-routes error:', err);
    res.status(500).json([]);
  }
});

/** GET /api/saved-routes/:id — una ruta por id */
router.get('/:id', (req, res) => {
  const routes = readRoutes();
  const id = String(req.params.id || '');
  const route = routes.find(r => (r.id || '') === id || String(routes.indexOf(r)) === id);
  if (!route) return res.status(404).json({ error: 'Ruta no encontrada' });
  res.json(route);
});

/** POST /api/saved-routes — guardar nueva ruta */
router.post('/', (req, res) => {
  const { name, waypoints } = req.body || {};
  const nameStr = (name != null && String(name).trim()) ? String(name).trim() : 'Ruta ' + (Date.now() % 100000);
  let pts = Array.isArray(waypoints) ? waypoints : [];
  pts = pts.filter(w => w && typeof w.lat === 'number' && typeof w.lon === 'number');
  if (pts.length < 2) {
    return res.status(400).json({ ok: false, error: 'Se necesitan al menos 2 puntos' });
  }
  try {
    const routes = readRoutes();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const route = {
      id,
      name: nameStr,
      waypoints: pts,
      createdAt: new Date().toISOString(),
    };
    routes.push(route);
    writeRoutes(routes);
    res.json({ ok: true, route });
  } catch (err) {
    console.error('POST /api/saved-routes error:', err);
    res.status(500).json({ ok: false, error: (err && err.message) || 'Error al guardar' });
  }
});

/** PUT /api/saved-routes/:id — actualizar ruta (nombre y/o waypoints) */
router.put('/:id', (req, res) => {
  const id = String(req.params.id || '');
  const { name, waypoints } = req.body || {};
  const routes = readRoutes();
  const idx = routes.findIndex(r => (r.id || '') === id || String(routes.indexOf(r)) === id);
  if (idx < 0) return res.status(404).json({ error: 'Ruta no encontrada' });
  const route = routes[idx];
  if (name != null && String(name).trim()) route.name = String(name).trim();
  if (Array.isArray(waypoints)) {
    const pts = waypoints.filter(w => w && typeof w.lat === 'number' && typeof w.lon === 'number');
    if (pts.length >= 2) route.waypoints = pts;
  }
  route.updatedAt = new Date().toISOString();
  writeRoutes(routes);
  res.json({ ok: true, route });
});

/** DELETE /api/saved-routes/:id */
router.delete('/:id', (req, res) => {
  const id = String(req.params.id || '');
  const routes = readRoutes();
  const idx = routes.findIndex(r => (r.id || '') === id || String(routes.indexOf(r)) === id);
  if (idx < 0) return res.status(404).json({ error: 'Ruta no encontrada' });
  routes.splice(idx, 1);
  writeRoutes(routes);
  res.json({ ok: true });
});

module.exports = router;
