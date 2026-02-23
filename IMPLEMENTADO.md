# Simulador ECU / OBD2 + GPS — Lo que está implementado (detalle)

Documento para explicar a otra IA (p. ej. ChatGPT) qué tiene este proyecto. **Stack:** Node.js (Express), frontend SPA en un solo HTML + JS modular, pensado para correr en Raspberry Pi 4.

---

## 1. Estructura del proyecto

- **Raíz:** `dashboard/` (no hay `package.json` en raíz; el servidor está en `app/`).
- **Servidor:** `app/index.js` — Express, escucha en `HTTP_PORT` (default 3000) y arranca TCP OBD2, BT y opcionalmente CAN.
- **Configuración:** `app/config.js` — Lee `.env` con `dotenv`. Variables: `HTTP_PORT`, `OBD_TCP_PORT`, `GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`.
- **Rutas API:** montadas bajo `/api/*` (host, system, gps-serial, gps, bt, obd, config, saved-routes).
- **Frontend:** `app/public/` — `index.html` (SPA), `js/main.js` (entrada, navegación, pestañas), `js/api.js` (fetch a `/api`), `js/gps-map.js`, `js/pages/*.js` (resumen, sistema, obd2, gps, route-creator). CSS en `app/public/css/styles.css`.
- **Datos persistentes:** `app/data/routes.json` — rutas guardadas (waypoints). Se crea el directorio si no existe.
- **Scripts auxiliares:** `scripts/can0-up.sh`, `scripts/ensure-can0-boot.sh`, `app/scripts/obd_bt_bridge.py` (puente Bluetooth Python), `app/scripts/bt-spp-register.sh`.

---

## 2. Emulador OBD2 (ECU del coche)

### 2.0 Perfiles de ECU (`app/lib/ecu-profile-manager.js`, `app/ecu-profiles/*.json`)

- **Perfiles JSON** en `app/ecu-profiles/` (ej. `captiva_2010_2.4.json`). Estructura: `vehicleName`, `protocol`, `requestId`, `responseId`, `pids[]` con `id`, `name`, `bytes`, `encode` (fórmula JS con variable `value`), opcionalmente `min`/`max` y `nameKey` (mapeo al estado del motor).
- **Validación:** `validate(profile)` comprueba campos requeridos y formato de PIDs.
- **Perfil activo:** `getActiveProfile()` devuelve el perfil cargado o un perfil **default interno** (equivalente al motor anterior: 04, 05, 0C, 0D, 0F, 2F). `load(name)` carga y activa un perfil por nombre (sin .json); `load('')` o sin nombre vuelve al default.
- **API:** `GET /api/ecu-profiles` lista perfiles disponibles y perfil activo; `POST /api/ecu-profiles/load` con `{ name: "captiva_2010_2.4" }` carga un perfil. El dashboard incluye `ecuProfile` en `GET /api/dashboard`.

### 2.1 Motor de datos y respuestas (`app/lib/obd-engine.js`)

- **Estado en memoria:** velocidad (km/h), RPM, temperatura refrigerante (°C), carga motor (%), temperatura admisión (°C), nivel combustible (%), tensión batería (mV).
- **DTC (códigos de fallo):** hasta 12 códigos; cada uno con `code` (ej. P0300), `stored`, `pending`. Normalización 5 caracteres (P/C/B/U + 4 dígitos). Codificación/decodificación para modos 03/07/0A.
- **PIDs modo 01:** definidos por el **perfil ECU activo** (no hardcodeados). 0100/0120/0140 se generan como bitmap desde los PIDs del perfil; 0101 fijo; el resto: valor desde `engine.data[nameKey]`, fórmula `encode` del perfil y bytes 1 o 2.
- **Simulación automática:** perfiles `idle`, `city`, `highway`. Tick cada 200 ms que actualiza RPM, velocidad, carga, refrigerante según perfil (ondas tipo seno).
- **Simulación de errores:** lista de PIDs que devuelven "NO DATA"; ruido porcentual sobre el valor (inestabilidad de sensor).
- **Modos OBD:** respuestas construidas para 01 (PID vivo), 03 (DTC almacenados), 07 (DTC pendientes), 0A (DTC permanentes), 04 (clear DTC).
- **Exportado:** `getSnapshot`, `setValues`, `setDtc`, `clearDtc`, `getDtcJson`, `startSimulation`, `stopSimulation`, `getErrorSimConfig`, `setErrorSimFailPids`, `setErrorSimNoise`, `getObdResponseHex` (para CAN).

### 2.2 Comandos ELM327 (`app/lib/obd-command.js`)

- **Parser:** normaliza entrada (quitar espacios, mayúsculas). Respuesta con eco opcional, saltos de línea y espacios configurables (ATE, ATL, ATS).
- **Comandos AT:** ATZ, ATWS, ATI, AT@1, ATDP, ATDPN, ATSP, ATRV, ATE0/1, ATL0/1, ATS0/1, ATH0/1, ATM, ATST, ATAT, ATD.
- **OBD:** reenvía a `obd-engine` para 01/03/07/0A/04; respuesta en hex con espacios (o sin si ATS0). Opción de prefijo de cabecera (7E8) con ATH1.

### 2.3 Servidor TCP (`app/lib/obd-tcp-server.js`)

- Escucha en `0.0.0.0:OBD_TCP_PORT` (default 35000).
- Por cada conexión: buffer de líneas (split por \r\n|\r|\n), cada línea se pasa a `processCommand` (obd-command) y se escribe la respuesta + `\r`.
- Registra conexiones y log de intercambios en `obd-connection-logger`.

### 2.4 Bluetooth (`app/lib/obd-bt-server.js`)

- Opción 1: módulo Node `bluetooth-serial-port` (BluetoothSerialPortServer) si está disponible y funciona en la plataforma.
- Opción 2: **puente Python** — script `app/scripts/obd_bt_bridge.py` (PyBluez): abre RFCOMM, acepta un cliente y reenvía a `127.0.0.1:OBD_TCP_PORT`. Variables de entorno: `OBD_BT_HCI`, `OBD_BT_RFCOMM_CHANNEL`.
- Estado expuesto: disponible, escuchando, conectado, error (o mensaje de “usar puente Python”).

### 2.5 CAN (SocketCAN) (`app/lib/obd-can-responder.js`)

- Opcional: se carga con `require('./lib/obd-can-responder')` y `startObdCanResponder('can0')`. Si falla (p. ej. sin socketcan o can0 no UP), se ignora.
- Escucha frames CAN (por `candump` o socket raw según implementación): peticiones 7DF (11-bit) y 18DB33F1 (29-bit). Respuestas 7E8 y 18DAF100.
- ISO-TP single frame: extrae modo+PID del payload, llama a `getObdResponseHex` (obd-engine) y envía la respuesta por CAN (si no está deshabilitado con `OBD_CAN_TX_DISABLE=1`).
- Variables de entorno: `OBD_PIDS_ALLOWED`, `OBD_11BIT_ONLY`, `OBD_CAN_TX_DISABLE`, `OBD_DEBOUNCE_MS`, `OBD_RESPONSE_DELAY_MS`, `OBD_CAN_STATE_INTERVAL_MS`.
- Registra conexiones y log en `obd-connection-logger`.

### 2.6 Log de conexiones (`app/lib/obd-connection-logger.js`)

- Map de conexiones: id, tipo (can/bt/tcp), dirección, macOrIp, connectedAt, lastActivity.
- Cola de log de intercambios (request/response) con límite de entradas.
- Funciones: `addConnection`, `removeConnection`, `logExchange`, `getConnections`, `getLog`, `getConnectionTypes`.

### 2.7 Rutas API OBD (`app/routes/obd.js`)

- **GET /api/dashboard** — snapshot del motor (speed, rpm, coolantTemp, engineLoad, intakeTemp, fuelLevel), simulación (enabled, profile, errorSim), estado BT (available, listening, connected, error), WiFi TCP 35000.
- **GET /api/bt-server-status** — estado del servidor BT.
- **GET /api/connections** — lista de conexiones (de obd-connection-logger).
- **GET /api/connection-log** — log de intercambios (query: limit, connectionId).
- **POST /api/set_values** — body: speed, rpm, coolantTemp, engineLoad, intakeTemp, fuelLevel.
- **GET /api/dtc** — DTC en JSON (code, stored, pending).
- **POST /api/set_dtc** — body: code, mode (stored|pending|all), on (0/1).
- **POST /api/clear_dtcs** — borra todos los DTC.
- **POST /api/simulation/start** — body: profile (idle|city|highway).
- **POST /api/simulation/stop**.
- **GET/POST /api/simulation/errors** — config de PIDs que fallan y ruido.
- **GET /api/command** — query `c`: ejecuta comando y devuelve respuesta en texto.
- **POST /api/command** — body `c`: igual.

---

## 3. Emulador GPS (NMEA por UART)

### 3.1 Estado del emulador (`app/lib/gps-emulator-state.js`)

- **Estado:** enabled, lat, lon, alt, sats, satsMin, satsMax, course, baud, routeOn, routeRadius, speedKmh, speedMinKmh, speedMaxKmh, currentSpeedKmh, intervalMs, routeWaypoints (array de {lat, lon} o null), routeProgress (null o { distanceTraveled } para waypoints, o { angle } para circular), lastTick, lastSentLat, lastSentLon, errorSim (noFix, badHdop, jitterMeters, dropPercent).
- **Funciones:** getStatus (devuelve también currentLat/currentLon desde lastSent o lat/lon), setConfig (parsea body: lat, lon, alt, sats, routeOn, routeRadius, speedKmh, speedMinKmh, speedMaxKmh, intervalMs, routeWaypoints, noFix, badHdop, jitterMeters, dropPercent), start, stop, setLastSentPosition, getStateRef. Si se aplica la misma ruta (mismo primer/último waypoint) no se resetea routeProgress.

### 3.2 Avance de ruta (`app/lib/gps-route.js`)

- **Ruta por waypoints:** se construyen distancias acumuladas entre puntos consecutivos (Haversine). Un único estado: `distanceTraveled` (metros desde el inicio). Cada tick: `distanceTraveled += (maxSpeed/3.6) * (elapsedMs/1000)`, limitado a la longitud total. La posición se obtiene interpolando en el segmento que corresponde a esa distancia. Si hay lastSent y ya había avance, se puede sincronizar con la distancia a lo largo de la ruta hasta ese punto (para no retroceder).
- **Ruta circular:** sin waypoints, orbita alrededor de (lat, lon) con routeRadius (m), ángulo de avance guardado en routeProgress.angle.
- **Funciones auxiliares:** distanceM, bearing, displace, buildCumulativeDistances, positionAtDistance, distanceAlongRouteToPoint.

### 3.3 Generación NMEA (`app/lib/nmea-generator.js`)

- **Frases:** GPGGA (posición, altitud, satélites, HDOP, fix), GPRMC (fecha/hora UTC, posición, velocidad en nudos, rumbo). Checksum NMEA.
- **Entrada:** lat, lon, alt, sats, course, speedKmh, hdop, noFix, date. Salida: array de strings sin CRLF.

### 3.4 Puerto serial y bucle de envío (`app/lib/gps-serial-state.js`, `app/lib/gps-serial-runner.js`)

- **Estado serial:** puerto abierto/cerrado, path, baudRate, lastSentLines. setPort, getPort, clearPort, setStatus, getStatus.
- **Runner:** solo corre si `enabled` y puerto abierto. Cada `intervalMs` (máx 1500): calcula elapsed, llama a `advanceRoute`, aplica jitter opcional, construye NMEA, escribe en el puerto, actualiza lastSentPosition y lastTick. Opcional: dropPercent (no envía trama), noFix/badHdop para simular fallos.

### 3.5 Rutas API GPS

- **GET /api/gps/status** — estado del emulador + serial (open, path, baudRate, lastSentLines).
- **POST /api/gps/config** — body con todos los parámetros de setConfig.
- **POST /api/gps/start** — exige puerto serial abierto; pone enabled y arranca el runner.
- **POST /api/gps/stop** — para el runner y desactiva.
- **GET /api/gps-serial/ports** — lista de puertos (path, manufacturer).
- **GET /api/gps-serial/status** — estado del puerto GPS.
- **POST /api/gps-serial/open** — body: path, baudRate.
- **POST /api/gps-serial/close**.
- **POST /api/gps-serial/send** — body: line (una línea NMEA).

---

## 4. Rutas guardadas y creador de rutas

### 4.1 API rutas (`app/routes/saved-routes.js`)

- **GET /api/saved-routes** — lista: id, name, waypoints, createdAt.
- **GET /api/saved-routes/:id** — una ruta.
- **POST /api/saved-routes** — body: name, waypoints (array de { lat, lon }). Guardado en `app/data/routes.json`.
- **DELETE /api/saved-routes/:id**.

### 4.2 Creador de rutas (frontend, `app/public/js/pages/route-creator.js`)

- **Mapa Google:** carga con API key de GET /api/config. Marcadores con AdvancedMarkerElement (o Marker clásico si falla), draggable.
- **Modos:** Inicio, Fin, Parada. Clic en el mapa coloca el punto; arrastrar actualiza posición. Paradas eliminables desde la lista.
- **Directions API:** con inicio, fin y paradas se llama a DirectionsService (DRIVING); se dibuja la ruta con DirectionsRenderer y se obtiene overview_path para guardar.
- **Guardar:** envía waypoints (path de la ruta por carretera) a POST /api/saved-routes. Opción de cargar ruta en el simulador GPS (POST /api/gps/config con routeWaypoints + POST /api/gps/config si aplica).

---

## 5. Dashboard web (frontend)

### 5.1 Páginas (SPA)

- **Resumen** — información general y enlaces.
- **Sistema (Pi)** — red (WiFi/BT), puertos serial, estado GPS serial; carga con GET /api/system.
- **Emulador OBD2** — pestañas: En vivo, Dispositivos, Controles, DTC/OBD, GPS.
  - En vivo: estado BT, tablero (velocidad, RPM, refrigerante, carga, admisión, combustible); datos vía polling a /api/dashboard.
  - Dispositivos: conexiones y log (GET /api/connections, /api/connection-log).
  - Controles: valores manuales (set_values), simulación start/stop (perfil idle/city/highway), simulación de errores (PIDs que fallan, ruido).
  - DTC: lista, añadir/encender DTC (set_dtc), clear (clear_dtcs).
  - GPS: posición inicial, velocidad mín/máx, intervalo, waypoints (textarea JSON o “Cargar ruta guardada”), errores simulados (no fix, HDOP, jitter, drop %). Botones Aplicar, Iniciar envío, Detener. Mapa con posición actual y polyline de la ruta (setGpsMapRoute). Polling a /api/gps/status para actualizar marcador.
- **Emulador GPS NEO** — abrir/cerrar puerto serial, listar puertos, enviar línea manual.
- **Creador de rutas** — mapa con inicio/fin/paradas, Generar ruta, lista de puntos, Limpiar, Guardar, lista de rutas guardadas (Cargar en simulador, Eliminar).
- **Hardware (Pi 4)** — texto e imágenes de diagramas de conexión (OBD2, GPS NEO).

### 5.2 Mapa GPS (`app/public/js/gps-map.js`)

- Inicialización con clave Google (y opcional mapId). Si hay mapId no se envían estilos (evitar conflicto con Cloud). gestureHandling greedy; controles Vista 2D, Inclinar 45°, Rotar 90°.
- Marcador: AdvancedMarkerElement o Marker; actualización de posición con updateGpsMapPosition(lat, lon).
- setGpsMapRoute(waypoints) — dibuja polyline de la ruta (color #00d4aa).

### 5.3 Otras rutas API

- **GET /api/config** — googleMapsApiKey, googleMapsMapId.
- **GET /api/host/network** — información de red (lib/network.js).
- **GET /api/system** — network, serialPorts, gpsSerial (lib/network + serial + gps-serial-state).

### 5.4 Bluetooth en UI (`app/routes/bt.js`)

- **GET /api/bt/adapters** — lista de adaptadores (getBluetoothAdapters desde lib/network).
- **GET /api/bt/started** — adaptadores puestos en “visible”.
- **POST /api/bt/start** — body: name o mac; ejecuta bluetoothctl (select, power on, discoverable on, pairable on) y opcionalmente arranca script Python bt_accept_agent para vinculación automática.
- **POST /api/bt/stop** — discoverable off, pairable off; opcionalmente mata el agente.
- **GET /api/bt/agent-log** — últimas líneas de /tmp/bt_accept_agent.log.

---

## 6. Dependencias y entorno

- **Node:** Express, dotenv, serialport (opcional), bluetooth-serial-port (opcional), socketcan (opcional). Los módulos nativos pueden no estar instalados o no compilar (p. ej. Node 20); el servidor sigue funcionando y usa alternativas (puente Python para BT, etc.).
- **.env:** HTTP_PORT, OBD_TCP_PORT, GOOGLE_MAPS_API_KEY, GOOGLE_MAPS_MAP_ID; opcionalmente OBD_BT_HCI, OBD_BT_RFCOMM_CHANNEL, OBD_PIDS_ALLOWED, OBD_11BIT_ONLY, OBD_CAN_TX_DISABLE, OBD_DEBOUNCE_MS, OBD_RESPONSE_DELAY_MS, OBD_RESPONSE_DELAY_MS, OBD_CAN_STATE_INTERVAL_MS.
- **Sistema:** pensado para Linux (Raspberry Pi); bluetoothctl, hciconfig, candump/cansend si se usa CAN; Python 3 + PyBluez para puente BT.

---

## 7. Flujos típicos

1. **Torque por WiFi:** Torque se conecta a IP_PI:35000 (TCP). El servidor TCP recibe comandos ELM327, responde con datos del obd-engine.
2. **Torque por Bluetooth:** Opción A: Pi con BT visible, Torque empareja y conecta por SPP; si hay BTServer nativo, atiende ahí; si no, se usa puente Python que abre RFCOMM y reenvía a localhost:35000. Opción B: Torque → adaptador ELM327 → conector OBD (CAN) → Pi con CAN; entonces obd-can-responder responde por CAN.
3. **GPS:** Usuario abre puerto serial (p. ej. /dev/serial0), aplica config (ruta guardada o waypoints), pulsa Iniciar; el runner avanza la posición por distancia + velocidad y envía NMEA por el puerto cada intervalMs. El mapa del dashboard actualiza la posición con polling a /api/gps/status.

Este documento refleja el estado del código tal como está implementado; cualquier cambio posterior en el repo puede no estar reflejado aquí.
