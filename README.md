# 🚗 Simulador ECU — OBD2 + GPS NEO

> **Una Raspberry Pi que emula la ECU de un vehículo y un GPS NEO.**  
> Dashboard web para gestionar **perfiles de vehículo**, **códigos de falla (DTC)**, sensores en vivo, rutas y NMEA por UART. **Importa datos desde Torque Pro** (Trip Logs) y úsalos como rutas con sensores. Conecta Torque u otra app OBD2 por WiFi, Bluetooth o CAN.

[![Raspberry Pi 4](https://img.shields.io/badge/Raspberry%20Pi%204-OK-green)](#plataforma) [![Pi Zero](https://img.shields.io/badge/Pi%20Zero%20%2F%202%20W-Soportado-orange)](#plataforma) [![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](#requisitos)

---

## Alcance del proyecto

Este proyecto no es solo un “puerto OBD2 virtual”: es un **sistema completo** para simular un vehículo y un GPS, con interfaz única en el navegador.

### Emulador OBD2 (ECU del vehículo)

- **Gestión de perfiles de vehículo**  
  Crea y edita perfiles por marca/modelo: nombre del vehículo, protocolo (ISO15765-4 CAN 11/29 bit, etc.), Request/Response ID, y **lista de PIDs** que responde la ECU. Los perfiles se guardan en JSON en `app/ecu-profiles/` y puedes activar cualquiera en caliente sin reiniciar.

- **Catálogo amplio de PIDs (modo 01)**  
  Decenas de PIDs estándar OBD-II (SAE J1979): carga motor, temperatura refrigerante/admisión, RPM, velocidad, combustible, MAF, TPS, sensores O2, presión rail, EGR, catalizador, par motor, etc. En el **creador de perfiles** eliges qué PIDs tendrá cada vehículo arrastrando desde el catálogo.

- **Administrador de códigos de falla (DTC)**  
  Añade o quita códigos de diagnóstico que la ECU reporta en **modo 03** (almacenados), **modo 07** (pendientes) y **modo 0A** (permanentes). Catálogo con **cientos de códigos estándar** (SAE J2012): P0xxx, P2xxx, P3xxx (powertrain), C (chassis), B (body), U (red). Cada código con descripción breve. Puedes asociar DTC típicos a cada perfil de vehículo.

- **Freeze frame (modo 02)**  
  Al activar un DTC se guarda una instantánea de los sensores; la ECU responde modo 02 con esos datos congelados, como en un vehículo real.

- **Información del vehículo (modo 09)**  
  VIN (17 caracteres), CALID y CVN configurables por perfil.

- **Simulación de conducción y de fallos**  
  Perfiles automáticos: *idle*, *ciudad*, *carretera* (RPM, velocidad, carga, temperatura con ondas realistas). Opción de simular **sensores que fallan** (NO DATA) e **inestabilidad** (ruido porcentual) para probar el comportamiento de las apps ante errores.

- **Conexión por WiFi, Bluetooth o CAN**  
  Servidor TCP (puerto 35000), servidor Bluetooth (SPP) o respuestas por SocketCAN (`can0`). Comandos AT y OBD estilo ELM327.

- **Logger y dispositivos**  
  Registro de conexiones y log de intercambios (comando/respuesta) por tipo de conexión. Pestaña de alertas y envío manual de comandos OBD para depuración.

### Emulador GPS NEO

- **Tramas NMEA 0183** (GPGGA, GPRMC) por el **UART de la Pi** (p. ej. GPIO 14 TX). Posición fija, ruta circular o **rutas guardadas** (waypoints). Simulación de errores: sin fix, HDOP malo, jitter, pérdida de tramas.

### Creador de rutas

- **Mapa (Google Maps)** para marcar inicio, fin y paradas; **Generar ruta** por carretera (Directions API) y **Guardar ruta**. Las rutas se cargan en el emulador GPS para reproducir el trayecto.

### Importar datos desde Torque Pro

- **Importar exportación de Torque (Trip Logs Export):** subes el ZIP que exportas desde **Torque Pro** en el móvil. El dashboard muestra un listado por carpetas de los archivos **CSV** (trip logs): tiempo, velocidad, RPM, temperatura, **latitud, longitud**, altitud GPS, etc.
- **Vista previa y filtros:** duración mínima, distancia mínima, rango de fechas, “solo con GPS”. Marcas qué archivos o carpetas importar y pulsas **Importar selección**. Los CSV se guardan en `app/data/torque-logs/`.
- **Rutas guardadas con sensores:** si los CSV tienen lat/lon, al importar se crean **rutas guardadas** con todos los puntos y datos de sensores (incl. velocidad por punto). Esas rutas aparecen en el **Creador de rutas** y en el **emulador GPS** (la velocidad por punto se usa en la reproducción). Los mismos CSV se usan en el **Logger del Emulador OBD2** para reproducir el trayecto con sensores en vivo.
- **Vista detallada:** por cada archivo puedes abrir una vista previa con mapa del recorrido, tabla de waypoints, columnas de sensores y reproducción (playback) del viaje.

### Dashboard y escenario

- **Resumen** del sistema (red, Bluetooth, estado OBD2 y GPS). **Exportar / Importar escenario**: un solo JSON con el estado completo (valores del motor, perfil activo, DTC, configuración GPS, ruta, etc.) para repetir pruebas o compartir configuraciones.

- **Ayuda integrada** con capturas de cada sección (menú, resumen, sistema, OBD2, GPS, creador de rutas, hardware, solución de problemas).

---

## ¿Para qué sirve?

| Caso de uso | Cómo te ayuda el simulador |
|-------------|----------------------------|
| **Desarrollar o probar apps OBD2** (Torque, etc.) | Conectas por WiFi/BT/CAN; cambias perfiles, DTC y sensores en vivo sin tocar un auto. |
| **Probar dispositivos o gateways** | La Pi responde como una ECU real (PIDs, DTC, freeze frame, VIN). |
| **Simular viajes con GPS** | Dibujas la ruta en el mapa, la reproduces por UART para navegadores o dispositivos que lean NMEA. |
| **Reutilizar viajes reales (Torque)** | Exportas los Trip Logs desde Torque Pro (ZIP), los importas en el dashboard y obtienes rutas guardadas + datos OBD por punto para el GPS y el Logger OBD2. |
| **Enseñar o hacer demos** | Exportas un escenario (fallas, ruta, velocidad) y lo importas en otro momento. |

Todo se controla desde **una sola interfaz web** en tu red (PC, tablet o móvil).

---

## Así se ve el dashboard

### Menú y resumen

Menú lateral (o bajo ☰ en móvil). **Resumen**: estado de la Pi, emulador OBD2 y GPS; tarjeta **Escenario** para exportar e importar la configuración completa.

![Menú lateral](app/public/imagenes/ayuda-menu-lateral.png)

![Resumen y Escenario](app/public/imagenes/ayuda-resumen-escenario.png)

### Emulador OBD2 — En vivo, controles y creador de perfiles

**En vivo:** cuadro de mandos (velocidad, RPM, refrigerante, carga, admisión, combustible). **Controles:** valores manuales, simulador de conducción (idle/ciudad/carretera), simulación de fallos (PIDs que no responden, ruido). **Crear perfil:** arrastras PIDs y DTC del catálogo al perfil, defines nombre, protocolo e IDs, guardas en `app/ecu-profiles/`.

![OBD2 pestañas](app/public/imagenes/ayuda-obd2-pestanas.png)

![OBD2 En vivo](app/public/imagenes/ayuda-obd2-en-vivo.png)

![OBD2 Controles](app/public/imagenes/ayuda-obd2-controles.png)

### Administrador de códigos DTC

Pestaña **DTC (códigos de fallo)**: introduces código (ej. P0301), eliges modo (stored / pending / all), Activar o Desactivar. La ECU los reporta en 03/07/0A. Borrar todos con un clic.

### Emulador GPS NEO

Puerto serial, baud rate, **Abrir puerto**. Configuración de posición/ruta y **Iniciar envío por serial** (desde la misma página o desde OBD2 → GPS).

![GPS NEO — Abrir puerto](app/public/imagenes/ayuda-gps-neo-abrir-puerto.png)

### Creador de rutas

Inicio, fin, paradas en el mapa; **Generar ruta** y **Guardar ruta** para usarla en el emulador GPS. Requiere `GOOGLE_MAPS_API_KEY` en `.env`.

![Creador de rutas](app/public/imagenes/ayuda-routes.png)

### Importar Torque Pro

Menú **Importar Torque**: subes el ZIP de la exportación **Trip Logs** de Torque Pro. Listado por carpetas (solo CSV útiles), filtros por duración, distancia y fechas. Marcas lo que quieres importar; se guardan en `app/data/torque-logs/` y, si tienen lat/lon, se crean rutas guardadas con sensores para el GPS y el Logger OBD2. Vista detallada con mapa del recorrido y datos por punto.

### Hardware (Pi 4)

Referencia de componentes, conector OBD2, MCP2515, pines GPIO y scripts para el bus CAN (`can0`).

![Hardware Pi 4](app/public/imagenes/ayuda-hardware.png)

---

## Uso en 4 pasos

1. **OBD2 por WiFi** — En Torque (o similar), conecta a la **IP de la Pi**, puerto **35000**. Misma red WiFi.
2. **OBD2 por Bluetooth** — **Sistema (Pi)** → adaptador BT → **Arrancar / Hacer visible** → empareja el celular y selecciona la Pi en la app.
3. **GPS por UART** — En **Emulador GPS NEO** abre el puerto (p. ej. `/dev/serial0`). En **OBD2 → GPS** configura posición o ruta, **Aplicar** e **Iniciar envío por serial**.
4. **Rutas** — En **Creador de rutas** dibuja la ruta, guárdala y cárgala en el emulador GPS para reproducirla.

La sección **Ayuda** del dashboard tiene más capturas y solución de problemas (conexión, Bluetooth, mapa que no carga, etc.).

---

## Instalación rápida

```bash
git clone https://github.com/WilmarC20/SimuladorEcu.git
cd SimuladorEcu/app
npm install
cp ../.env.example ../.env
# Opcional: edita ../.env y añade GOOGLE_MAPS_API_KEY para mapas
npm start
```

Abre en el navegador: `http://<IP-de-tu-Pi>:3000` (o `http://localhost:3000` en la misma máquina).

---

## Configuración (.env)

| Variable | Descripción |
|----------|-------------|
| `HTTP_PORT` | Puerto del dashboard (por defecto 3000) |
| `OBD_TCP_PORT` | Puerto TCP del emulador OBD2 (por defecto 35000) |
| `GOOGLE_MAPS_API_KEY` | Clave de Google Maps (Creador de rutas y mapas) |
| `GOOGLE_MAPS_MAP_ID` | Map ID opcional para estilos |

Copia `.env.example` a `.env` y no subas `.env` al repositorio.

---

## Plataforma y requisitos

- **Raspberry Pi 4** (2/4/8 GB): probado y recomendado.
- **Raspberry Pi Zero / Zero 2 W**: soportado (menor carga; CAN opcional o uso ligero).
- **Node.js** ≥ 18, **Raspberry Pi OS** (o compatible). UART habilitado si usas el emulador GPS por pines. Opcional: SocketCAN y bus `can0` para OBD2 por CAN.

---

## Estructura del repositorio

```
├── app/                    # Servidor Node.js y frontend (dashboard)
│   ├── index.js            # Entrada del servidor
│   ├── config.js           # Lectura de .env
│   ├── public/             # HTML, CSS, JS e imágenes (incl. ayuda)
│   ├── lib/                # Motor OBD2, GPS, CAN, Bluetooth, perfiles ECU
│   ├── routes/             # Rutas API (/api/*)
│   ├── ecu-profiles/       # Perfiles de vehículo (JSON)
│   └── data/               # Rutas guardadas (routes.json)
├── docs/                   # Documentación hardware (Pi, CAN, OBD2)
├── scripts/                # Scripts CAN (can0-up, ensure-can0-boot)
├── deploy/                 # Servicio systemd de ejemplo
└── .env.example            # Plantilla de variables de entorno
```

La carpeta **Tracker360** (firmware u otro código externo) no forma parte de este repo.

---

## Repositorio

**[GitHub — WilmarC20/SimuladorEcu](https://github.com/WilmarC20/SimuladorEcu)**

Proyecto de código abierto. Para reportar fallos o contribuir, usa los *issues* y *pull requests* del repositorio.
