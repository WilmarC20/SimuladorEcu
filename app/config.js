'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  HTTP_PORT: Number(process.env.HTTP_PORT) || 3000,
  OBD_TCP_PORT: Number(process.env.OBD_TCP_PORT) || 35000,
  /** Clave API de Google Maps (opcional). En .env usar GOOGLE_MAPS_API_KEY (o GOOGLE_MAPS_KEY). */
  GOOGLE_MAPS_API_KEY: (process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || '').trim() || null,
  /** Map ID para Advanced Markers (opcional). Crear en Google Cloud Console → Map Management. Si no se define, se usa DEMO_MAP_ID o Marker clásico. */
  GOOGLE_MAPS_MAP_ID: (process.env.GOOGLE_MAPS_MAP_ID || '').trim() || null,
};
