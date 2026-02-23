#!/usr/bin/env node
'use strict';

/**
 * Importa una ruta desde un JSON de sesión GPS (formato Waze/export) y la guarda en app/data/routes.json.
 * Uso: node scripts/import-gps-session-route.js <archivo.json> "<nombre de la ruta>"
 */
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const sessionPath = args[0] || path.join(__dirname, '..', 'gpsWaze', 'CityU-Casa-SessionGPS.json');
const routeName = args[1] || 'City U - Casa';

const routesFile = path.join(__dirname, '..', 'app', 'data', 'routes.json');

function loadSession(pathToFile) {
  const raw = fs.readFileSync(pathToFile, 'utf8');
  return JSON.parse(raw);
}

function extractWaypoints(data) {
  const waypoints = [];
  try {
    const objects = data.archiveSessions?.objects;
    if (!Array.isArray(objects) || objects.length === 0) return waypoints;
    for (const obj of objects) {
      const parts = obj.driveParts || [];
      for (const part of parts) {
        const coords = part.geometry?.coordinates;
        if (!Array.isArray(coords)) continue;
        for (const [lon, lat] of coords) {
          if (typeof lat === 'number' && typeof lon === 'number') {
            waypoints.push({ lat, lon });
          }
        }
      }
    }
  } catch (e) {
    console.error('Error extrayendo waypoints:', e.message);
  }
  return waypoints;
}

function ensureDataDir() {
  const dir = path.dirname(routesFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readRoutes() {
  ensureDataDir();
  if (!fs.existsSync(routesFile)) return [];
  try {
    const data = fs.readFileSync(routesFile, 'utf8');
    const arr = JSON.parse(data);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function writeRoutes(routes) {
  ensureDataDir();
  fs.writeFileSync(routesFile, JSON.stringify(routes, null, 2), 'utf8');
}

const data = loadSession(sessionPath);
const waypoints = extractWaypoints(data);

if (waypoints.length < 2) {
  console.error('Se necesitan al menos 2 puntos. Encontrados:', waypoints.length);
  process.exit(1);
}

const routes = readRoutes();
const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const route = {
  id,
  name: routeName,
  waypoints,
  createdAt: new Date().toISOString(),
};
routes.push(route);
writeRoutes(routes);

console.log('Ruta guardada:', routeName);
console.log('ID:', id);
console.log('Waypoints:', waypoints.length);
