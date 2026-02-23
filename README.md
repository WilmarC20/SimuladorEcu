# Simulador ECU — OBD2 + GPS NEO

**Dashboard y emuladores OBD2 / GPS para Raspberry Pi.** Interfaz web única para simular una ECU de vehículo (sensores, DTC, perfiles) y un GPS NEO por UART, con creador de rutas y soporte Bluetooth/WiFi/CAN.

---

## Alcance del proyecto

Este proyecto permite:

- **Emular una ECU (OBD2)**  
  Respuestas ELM327 por **TCP** (puerto 35000), **Bluetooth** o **CAN (SocketCAN)**. Sensores en vivo (velocidad, RPM, temperatura, carga, combustible), códigos DTC, perfiles de vehículo y simulación de conducción (idle, ciudad, carretera).

- **Emular un GPS NEO**  
  Tramas **NMEA 0183** (GPGGA, GPRMC) por el **UART de la Pi** (GPIO 14 TX). Punto fijo, ruta circular o rutas guardadas; opcionalmente simulación de errores (sin fix, HDOP, jitter).

- **Creador de rutas**  
  Mapa (Google Maps) para dibujar inicio, fin y paradas; genera la ruta por carretera y guarda waypoints con datos de sensores. Las rutas se pueden cargar en el emulador GPS.

- **Dashboard unificado**  
  Resumen del sistema, red y Bluetooth, puertos seriales, configuración del emulador OBD2 (tablero en vivo, dispositivos, controles, perfiles, DTC), configuración del GPS (puerto serial, posición, envío), importación de escenarios y ayuda integrada.

---

## Plataforma

- **Desarrollado y probado en Raspberry Pi 4** (2/4/8 GB).  
- **Diseñado para funcionar también en Raspberry Pi Zero** (y Zero 2 W), con menor carga (sin CAN opcional o con uso ligero del dashboard).

El servidor es Node.js (Express); el frontend es una SPA en un solo HTML con JS modular, accesible desde cualquier navegador en la red (PC, tablet o móvil).

---

## Requisitos

- **Node.js** ≥ 18  
- **Raspberry Pi OS** (o compatible) con UART habilitado si usas el emulador GPS por pines  
- Opcional: **SocketCAN** y bus `can0` para emulación OBD2 por CAN  
- Opcional: **Google Maps API Key** (en `.env`) para el Creador de rutas y mapas

---

## Instalación rápida

```bash
cd app
npm install
cp ../.env.example ../.env
# Edita ../.env y añade tu GOOGLE_MAPS_API_KEY si quieres mapas
npm start
```

Abre en el navegador: `http://<IP-de-tu-Pi>:3000` (o `http://localhost:3000` si ejecutas en la misma máquina).

---

## Configuración

Copia `.env.example` a `.env` y ajusta:

| Variable | Descripción |
|----------|-------------|
| `HTTP_PORT` | Puerto del dashboard (por defecto 3000) |
| `OBD_TCP_PORT` | Puerto TCP del emulador OBD2 (por defecto 35000) |
| `GOOGLE_MAPS_API_KEY` | Clave de Google Maps (Creador de rutas y mapas) |
| `GOOGLE_MAPS_MAP_ID` | Map ID opcional para estilos avanzados |

No subas el archivo `.env` al repositorio; contiene datos sensibles.

---

## Estructura del repositorio

```
├── app/                 # Servidor Node.js y frontend
│   ├── index.js         # Entrada del servidor
│   ├── config.js        # Lectura de .env
│   ├── public/          # HTML, CSS, JS e imágenes del dashboard
│   ├── lib/             # Motor OBD2, GPS, CAN, Bluetooth, etc.
│   ├── routes/          # Rutas API (/api/*)
│   └── data/            # Rutas guardadas (routes.json)
├── docs/                # Documentación de hardware (Pi, CAN, OBD2)
├── scripts/             # Scripts CAN (can0-up, ensure-can0-boot)
├── deploy/              # Servicio systemd de ejemplo
├── .env.example         # Plantilla de variables de entorno
└── README.md            # Este archivo
```

La carpeta **Tracker360** (firmware Arduino u otro código externo) no forma parte de este repositorio y no se sube.

---

## Uso típico

1. **OBD2 por WiFi:** Conecta la app (p. ej. Torque) a la IP de la Pi, puerto **35000**.  
2. **OBD2 por Bluetooth:** En el dashboard, **Sistema (Pi)** → elige adaptador BT → **Arrancar / Hacer visible**; empareja el celular y en la app selecciona la Pi.  
3. **GPS por UART:** En **Emulador GPS NEO** abre el puerto serial (p. ej. `/dev/serial0`), configura posición o ruta en la misma página y pulsa **Aplicar** e **Iniciar envío por serial**.  
4. **Rutas:** En **Creador de rutas** dibuja una ruta, guárdala y cárgala en el emulador GPS para reproducirla.

La sección **Ayuda** del dashboard incluye capturas y pasos detallados (menú, resumen, sistema, OBD2, GPS, rutas, hardware y solución de problemas).

---

## Licencia y contacto

Proyecto de código abierto. Para reportar fallos o contribuir, usa los issues y merge requests del repositorio.

**Repositorio:** [GitHub — WilmarC20/SimuladorEcu](https://github.com/WilmarC20/SimuladorEcu)
