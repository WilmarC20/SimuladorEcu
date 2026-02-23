'use strict';

/**
 * Calcula la posición actual en una ruta simulada.
 * - Con waypoints: avanza por el segmento actual según velocidad y tiempo.
 * - Sin waypoints (ruta circular): orbita alrededor de (lat, lon) con routeRadius.
 */

const EARTH_R = 6371000; // metros

function toRad(deg) {
  return (deg * Math.PI) / 180;
}
function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

/**
 * Desplaza un punto (lat, lon) por distancia en metros en una dirección (bearing en grados 0-360).
 */
function displace(lat, lon, distanceM, bearingDeg) {
  const br = toRad(bearingDeg);
  const latR = toRad(lat);
  const lonR = toRad(lon);
  const dR = distanceM / EARTH_R;
  const lat2 = Math.asin(Math.sin(latR) * Math.cos(dR) + Math.cos(latR) * Math.sin(dR) * Math.cos(br));
  const lon2 = lonR + Math.atan2(Math.sin(br) * Math.sin(dR) * Math.cos(latR), Math.cos(dR) - Math.sin(latR) * Math.sin(lat2));
  return { lat: toDeg(lat2), lon: toDeg(lon2) };
}

/**
 * Distancia aproximada entre dos puntos (Haversine), en metros.
 */
function distanceM(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_R * c;
}

/**
 * Bearing de (lat1,lon1) a (lat2,lon2) en grados 0-360.
 */
function bearing(lat1, lon1, lat2, lon2) {
  const lat1R = toRad(lat1);
  const lat2R = toRad(lat2);
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(lat2R);
  const x = Math.cos(lat1R) * Math.sin(lat2R) - Math.sin(lat1R) * Math.cos(lat2R) * Math.cos(dLon);
  let b = toDeg(Math.atan2(y, x));
  if (b < 0) b += 360;
  return b;
}

const DECEL_DIST_M = 12;
const ACCEL_FACTOR = 0.28;

/**
 * Construye distancias acumuladas: cumDist[i] = metros desde waypoints[0] hasta waypoints[i].
 * cumDist[0]=0, cumDist[1]=d(0,1), cumDist[2]=d(0,1)+d(1,2), ...
 */
function buildCumulativeDistances(waypoints) {
  const cum = [0];
  for (let i = 1; i < waypoints.length; i++) {
    const d = distanceM(waypoints[i - 1].lat, waypoints[i - 1].lon, waypoints[i].lat, waypoints[i].lon);
    cum[i] = cum[i - 1] + d;
  }
  return cum;
}

/**
 * Dado una distancia recorrida (metros desde el inicio), devuelve { lat, lon, seg, t, course }.
 * t = fracción dentro del segmento (0..1).
 */
function positionAtDistance(waypoints, cumDist, distanceTraveled) {
  const lastIdx = waypoints.length - 1;
  const totalLen = cumDist[lastIdx];
  if (distanceTraveled >= totalLen - 0.01) {
    const w = waypoints[lastIdx];
    const prev = waypoints[lastIdx - 1];
    return { lat: w.lat, lon: w.lon, seg: lastIdx - 1, t: 1, course: bearing(prev.lat, prev.lon, w.lat, w.lon) };
  }
  let i = 0;
  while (i < lastIdx && cumDist[i + 1] <= distanceTraveled) i++;
  const segLen = cumDist[i + 1] - cumDist[i];
  const t = segLen > 0.001 ? (distanceTraveled - cumDist[i]) / segLen : 0;
  const A = waypoints[i];
  const B = waypoints[i + 1];
  const lat = A.lat + t * (B.lat - A.lat);
  const lon = A.lon + t * (B.lon - A.lon);
  const course = bearing(A.lat, A.lon, B.lat, B.lon);
  return { lat, lon, seg: i, t, course };
}

/** Velocidad en km/h en la posición actual: usa speedKmh del waypoint si existe, o interpola entre segmento. */
function speedAtPosition(waypoints, seg, t, fallbackKmh) {
  if (!waypoints || waypoints.length === 0) return fallbackKmh;
  const a = waypoints[seg];
  const b = waypoints[Math.min(seg + 1, waypoints.length - 1)];
  const sa = a && typeof a.speedKmh === 'number' && a.speedKmh >= 0 ? a.speedKmh : null;
  const sb = b && typeof b.speedKmh === 'number' && b.speedKmh >= 0 ? b.speedKmh : null;
  if (sa != null && sb != null) return sa + t * (sb - sa);
  if (sa != null) return sa;
  if (sb != null) return sb;
  return fallbackKmh;
}

/**
 * Distancia a lo largo de la ruta hasta el punto más cercano a (qLat, qLon).
 */
function distanceAlongRouteToPoint(waypoints, cumDist, qLat, qLon) {
  if (!waypoints || waypoints.length < 2 || !cumDist) return 0;
  let bestDist = Infinity;
  let bestDAlong = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const A = waypoints[i];
    const B = waypoints[i + 1];
    const segLen = cumDist[i + 1] - cumDist[i];
    if (segLen < 0.001) continue;
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const pLat = A.lat + t * (B.lat - A.lat);
      const pLon = A.lon + t * (B.lon - A.lon);
      const d = distanceM(qLat, qLon, pLat, pLon);
      const dAlong = cumDist[i] + t * segLen;
      if (d < bestDist) {
        bestDist = d;
        bestDAlong = dAlong;
      }
    }
  }
  return bestDAlong;
}

/**
 * Avanza la posición en la ruta según estado y tiempo transcurrido.
 * Simula aceleración (hacia speedMaxKmh) y frenado (hacia speedMinKmh) según min/max.
 *
 * @param {object} state - Estado del emulador (lat, lon, routeOn, routeWaypoints, speedKmh, speedMinKmh, speedMaxKmh, currentSpeedKmh, routeProgress, ...)
 * @param {number} elapsedMs - Milisegundos desde el último tick
 * @returns {{ lat, lon, alt, course, speedKmh }} Posición y rumbo actuales
 */
function advanceRoute(state, elapsedMs) {
  const base = {
    lat: state.lat,
    lon: state.lon,
    alt: state.alt != null ? state.alt : 0,
    course: state.course != null ? state.course : 0,
    speedKmh: state.speedKmh != null ? state.speedKmh : 20,
  };

  if (!state.routeOn) return base;

  const waypoints = state.routeWaypoints && Array.isArray(state.routeWaypoints) && state.routeWaypoints.length > 0
    ? state.routeWaypoints
    : null;

  const speedMin = state.speedMinKmh != null ? Math.max(0, state.speedMinKmh) : (state.speedKmh != null ? state.speedKmh : 20);
  const speedMax = state.speedMaxKmh != null ? Math.max(0, state.speedMaxKmh) : (state.speedKmh != null ? state.speedKmh : 50);
  const maxSpeed = Math.max(speedMin, speedMax);
  const minSpeed = Math.min(speedMin, speedMax);

  if (waypoints && waypoints.length >= 2) {
    const cumDist = buildCumulativeDistances(waypoints);
    const totalLen = cumDist[cumDist.length - 1];
    if (totalLen < 0.01) {
      base.lat = waypoints[0].lat;
      base.lon = waypoints[0].lon;
      return base;
    }

    let distanceTraveled = 0;
    if (state.routeProgress != null && typeof state.routeProgress.distanceTraveled === 'number') {
      distanceTraveled = Math.max(0, state.routeProgress.distanceTraveled);
    }
    if (distanceTraveled > 0 && state.lastSentLat != null && state.lastSentLon != null) {
      const dAlong = distanceAlongRouteToPoint(waypoints, cumDist, state.lastSentLat, state.lastSentLon);
      if (dAlong > distanceTraveled) distanceTraveled = dAlong;
    }

    const posBefore = positionAtDistance(waypoints, cumDist, distanceTraveled);
    const speedKmhUse = speedAtPosition(waypoints, posBefore.seg, posBefore.t != null ? posBefore.t : 0, maxSpeed);
    const speedMs = (speedKmhUse / 3.6) * (elapsedMs / 1000);
    distanceTraveled = Math.min(totalLen, distanceTraveled + Math.max(0, speedMs));

    state.routeProgress = { distanceTraveled };

    if (distanceTraveled >= totalLen - 0.01) {
      const w = waypoints[waypoints.length - 1];
      base.lat = w.lat;
      base.lon = w.lon;
      const lastSpeed = (w && typeof w.speedKmh === 'number' && w.speedKmh >= 0) ? w.speedKmh : minSpeed;
      base.speedKmh = state.currentSpeedKmh != null ? state.currentSpeedKmh : lastSpeed;
      state.currentSpeedKmh = lastSpeed;
      const prev = waypoints[waypoints.length - 2];
      base.course = bearing(prev.lat, prev.lon, w.lat, w.lon);
      return base;
    }

    const pos = positionAtDistance(waypoints, cumDist, distanceTraveled);
    base.lat = pos.lat;
    base.lon = pos.lon;
    base.course = pos.course;
    base.speedKmh = speedAtPosition(waypoints, pos.seg, pos.t != null ? pos.t : 0, maxSpeed);
    state.currentSpeedKmh = base.speedKmh;
    return base;
  }

  // Ruta circular alrededor de (state.lat, state.lon)
  const speedKmhUse = state.speedKmh != null ? state.speedKmh : 20;
  const speedMs = (speedKmhUse / 3.6) * (elapsedMs / 1000);
  if (speedMs <= 0) return base;
  const radius = (state.routeRadius != null && state.routeRadius > 0) ? state.routeRadius : 50;
  const angle = (state.routeProgress && state.routeProgress.angle != null) ? state.routeProgress.angle : 0;
  const circumference = 2 * Math.PI * radius;
  const angleStep = (speedMs / circumference) * 360;
  let newAngle = angle + angleStep;
  if (newAngle >= 360) newAngle -= 360;
  if (newAngle < 0) newAngle += 360;
  state.routeProgress = { angle: newAngle };
  const pos = displace(state.lat, state.lon, radius, newAngle);
  base.lat = pos.lat;
  base.lon = pos.lon;
  // Rumbo tangente al círculo (avance en sentido horario: course = angle + 90)
  base.course = (newAngle + 90) % 360;
  return base;
}

module.exports = { advanceRoute, displace, distanceM, bearing };
