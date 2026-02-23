# Sistemas de referencia y mejoras posibles

Documento que describe sistemas similares o más completos al dashboard OBD2 + GPS NEO, qué podemos implementar de ellos (software y hardware) y qué más mejorar.

---

## 1. Sistemas de referencia encontrados

### 1.1 OBDSim (software, open source)

- **Qué es:** Simulador de dispositivo ELM327 que corre en Linux/Windows/macOS. Muy usado para desarrollar y probar software OBD sin coche real.
- **Características relevantes:**
  - **Múltiples ECUs:** Varios “generadores” de datos a la vez, cada uno simula una ECU distinta.
  - **Múltiples protocolos:** Diferentes presentaciones de cabeceras según el protocolo; listado con `--list-protocols`.
  - **Comandos AT ELM327:** Respeta eco, cabeceras, espacios, selección de protocolo (ATE, ATH, ATS, ATSP, etc.).
  - **Generadores (plugins):**
    - **Logger:** Lee logs de obdgpslogger e interpola valores (reproducción de trayectos reales).
    - **Cycle:** Valores que cambian en ciclos (tiempo, “marchas”).
    - **Random:** Respuestas aleatorias para los primeros PIDs.
    - **Socket:** Puente para dongles WiFi cuando el software no es “network-aware”.
    - **DBus:** Escucha mensajes key/value por D-Bus y mapea a PIDs vía config (proxy desde otros sistemas).
    - **dlopen:** Carga plugins .so/.dll para fuentes de datos propietarias.
  - **Benchmarking:** Mide tasa de muestreo.
  - **Log de comunicaciones:** Registro de todo el tráfico serial.
  - **GUI opcional (FLTK)** para ajustar parámetros.

**Enlace:** [OBDSim](https://icculus.org/obdgpslogger/obdsim.html)

---

### 1.2 ECUsim 5100 (hardware profesional)

- **Qué es:** Simulador OBD multiprotocolo de banco para desarrollo y pruebas (OBD Solutions / Scantool).
- **Protocolos:** J1850 PWM/VPW, ISO 9141-2, ISO 14230-4 (KWP2000), ISO 15765-4 (CAN 250/500 kbps, 11/29 bit).
- **Virtual ECUs:** Hasta 3 módulos (PIM), cada uno con ECM, TCM y ABS.
- **Modos SAE J1979:** 1, 2, 3, 4, 7, 9, 0A.
- **Configuración:** ECUs, PIDs, DTCs y freeze frames personalizables; 5 mandos físicos asignables (temperatura, RPM, velocidad, etc.).
- **Conector:** J1962 estándar, USB para config y monitoreo, firmware actualizable.

**Referencia:** [ECUsim 5100](https://www.obdsol.com/solutions/development-tools/obd-simulators/ecusim-5100/)

---

### 1.3 Freematics OBD-II Emulator MK2 (hardware)

- **Qué es:** Emulador OBD-II listo para usar (~395 USD) para pruebas y desarrollo.
- **Protocolos:** J1939, J1850 VPW/PWM, ISO 9141-2, KWP2000 (5 baud y fast), CAN 11/29 bit a 250k y 500k.
- **DTC:** Modos 03, 07, 0A; hasta 6 DTC simultáneos.
- **Modo 01:** PIDs configurables (valores fijables y consultables).
- **J1939:** Soporte SPN (Suspect Parameter Number).
- **VIN, CALID, CVN:** Configuración y lectura.
- **Interfaz:** Serial 38400 bps, conjunto de comandos AT para configurar.
- **Software:** GUI en Windows para DTC, VIN, actualización de firmware.

**Referencia:** [Freematics OBD-II Emulator MK2](https://freematics.com/store/index.php?route=product%2Fproduct&product_id=71)

---

### 1.4 neoOBD2-SIM (Intrepid Control Systems)

- **Qué es:** Simulador de ECU portable con dos canales CAN/CAN FD.
- **Características:** Simulaciones basadas en scripts (Function Blocks), integración con Vehicle Spy; soporte ISO 14229 (UDS), CCP/XCP, J1939; batería 2000 mAh, USB Type-C; display y LEDs programables.

**Referencia:** [neoOBD2-Sim](https://guide.intrepidcs.com/docs/neoOBD2-Sim/Introduction-and-Overview.html)

---

### 1.5 Plataformas de telemetría y flota (software en la nube)

Sistemas como **Navixy**, **Samsara**, **Zubie**, **AutoPi** ofrecen:

- **GPS en tiempo real** y mapas (vista “helicóptero”, historial de rutas).
- **OBD-II:** DTC, estado del motor, alertas de mantenimiento y batería.
- **Geofencing:** Notificaciones al entrar/salir de zonas.
- **Comportamiento del conductor:** excesos de velocidad, frenados bruscos, ralentí.
- **Alertas:** DTC, fallos de motor, actividad anómala; notificaciones por SMS, email, webhooks.
- **Dashboards:** Estado del vehículo (en marcha, ralentí, apagado, offline), viajes, métricas de rendimiento.
- **Integración:** Dispositivos diversos (OBD, CAN, sensores); transformaciones y enriquecimiento de datos en tiempo real.

---

## 2. Qué podemos implementar (inspirado en estos sistemas)

### 2.1 Del lado OBD2 / ECU

| Idea | Origen | Descripción breve |
|------|--------|-------------------|
| **Reproducir trayectos desde log (modo “Logger”)** | OBDSim | Importar un archivo de log (obdgpslogger u otro con timestamp + PIDs) y que el emulador devuelva valores interpolados en el tiempo. Útil para reproducir un viaje real en banco. |
| **Múltiples ECUs / direcciones de respuesta** | OBDSim, ECUsim | Simular ECM + TCM (y opcionalmente ABS) con IDs de respuesta distintos (p. ej. 7E8, 7E9) y repartir PIDs entre ellos. |
| **Más comandos AT ELM327** | OBDSim | Completar soporte AT (adaptador, timeouts, etc.) para compatibilidad máxima con apps que asumen ELM327 estricto. |
| **Benchmark / tasa de muestreo** | OBDSim | Endpoint o panel que mida cuántas peticiones/segundo aguanta el sistema y latencia media (útil para desarrollo). |
| **Freeze frame (modo 02)** | ECUsim, estándar | Ya tenéis modo 02; asegurar que cada DTC pueda llevar su freeze frame (condiciones en el momento del fallo). |
| **Modo 09 ampliado** | Estándar, Freematics | VIN, CALID, CVN ya los tenéis; si falta algo de readiness (modo 01 01, 41 01) o mensajes de soporte, completarlos. |
| **Perfiles de “viaje” (cycle)** | OBDSim Cycle | Perfil de simulación que repita un ciclo (ej. 0→vel_max→0, con “marchas” simuladas) de duración configurable. |

### 2.2 Del lado GPS / NMEA

| Idea | Origen | Descripción breve |
|------|--------|-------------------|
| **Más tramas NMEA** | NMEA Simulator, gpsfake | Añadir GPGLL, GPVTG, GPGSV (satélites) si el dispositivo bajo prueba las usa. |
| **Reproducir ruta desde log** | OBDSim Logger + GPS | Mismo concepto que el Logger OBD: un log con timestamps y lat/lon (y opcionalmente alt, velocidad) para “reproducir” un recorrido por UART. |
| **Señal K / protocolos marinos** | NMEASimulator | Si en el futuro se requiere compatibilidad con entornos náuticos o Signal K, definir un pequeño módulo de salida adicional. |

### 2.3 Dashboard y experiencia de uso

| Idea | Origen | Descripción breve |
|------|--------|-------------------|
| **Alertas configurables** | Flota (Navixy, Samsara) | Reglas tipo “si DTC P0300 → notificación” o “si velocidad &gt; 120 km/h más de 5 s → aviso”. Guardar reglas en JSON y evaluarlas en backend o en el motor OBD. |
| **Geofencing simple** | Flota | Definir polígonos o círculos (lat, lon, radio); cuando la posición simulada entre/salga, evento o log. Útil para pruebas de apps que usan geocercas. |
| **Historial de “viajes”** | Flota | Guardar sesiones de simulación (inicio/fin, ruta usada, PIDs/DTC activos) para revisar después o reutilizar como “log” para el modo Logger. |
| **Exportar/importar estado completo** | ECUsim, Freematics | Un JSON con perfil ECU, DTCs, valores actuales, ruta GPS y opciones de simulación; cargar ese “escenario” con un solo clic. |
| **Driver behavior (opcional)** | Flota | En modo simulación, marcar eventos “frenado brusco” o “aceleración fuerte” (cambios de velocidad) y exponerlos en API o en el dashboard para probar apps de estilo telemático. |

### 2.4 Integración y API

| Idea | Origen | Descripción breve |
|------|--------|-------------------|
| **Webhooks / notificaciones** | Flota | Al activar DTC, superar umbral o entrar/salir de geocerca, hacer POST a una URL configurable (webhook). |
| **API REST más rica** | Todos | Documentar y estabilizar endpoints para “estado completo”, “aplicar escenario”, “iniciar/parar Logger desde log file”. |
| **Modo “proxy” (DBus/socket)** | OBDSim | Opcional: leer valores de otra fuente (otro proceso, otro dispositivo) y mapearlos a PIDs; nuestro emulador actuaría como proxy hacia apps OBD. |

---

## 3. Hardware que tiene sentido mencionar

- **Ya contemplado en vuestro diseño:** Raspberry Pi 4, MCP2515 (CAN por SPI), MCP2551 (transceptor CAN), conector OBD2 hembra, UART para GPS NEO (TX/RX por GPIO).
- **Referencia comercial (para comparar):**
  - **ECUsim 5100:** Múltiples protocolos, varios ECUs virtuales, mandos físicos; concepto de “escenario” y PIDs/DTC configurables.
  - **Freematics Emulator MK2:** Un solo dispositivo que ya trae varios protocolos y comandos AT; idea de “todo en una caja” con interfaz serial.
  - **neoOBD2-SIM:** Portable, CAN FD, scripting; orientado a pruebas avanzadas y desarrollo.
- **Opcional para ampliar:**
  - **Pantalla pequeña (LCD/OLED)** en la Pi para estado básico (conectado, perfil activo, DTC count) sin depender del navegador.
  - **LEDs o display 7 segmentos** para modo “kiosk” o demostración (velocidad, RPM, estado).
  - **Botón físico o GPIO** para “siguiente escenario” o “reiniciar simulación” en pruebas en banco.

Nada de lo anterior es obligatorio; vuestro enfoque “Pi + CAN + UART + dashboard web” ya cubre el núcleo; lo demás son mejoras de usabilidad o fidelidad respecto a sistemas comerciales.

---

## 4. Resumen: qué priorizar

**Corto plazo (alto impacto, alineado con lo que ya tenéis):**

1. **Reproducción desde log (Logger):** Importar un log (OBD + opcionalmente GPS) y reproducirlo en el tiempo (OBD interpolado; GPS siguiendo waypoints o timestamps).
2. **Exportar/importar escenario:** Un JSON con perfil, DTCs, valores, ruta y opciones; cargar y guardar desde el dashboard.
3. **Alertas simples:** Reglas (DTC activo, velocidad &gt; X) y notificación en la UI o por webhook.
4. **Más tramas NMEA** si los dispositivos que probáis lo requieren (GPGLL, GPVTG, GPGSV).

**Medio plazo:**

5. **Múltiples ECUs** (7E8/7E9) y reparto de PIDs (ECM/TCM).
6. **Geofencing básico** para la posición simulada (eventos entrada/salida).
7. **Benchmark de tasa de muestreo** en el panel OBD.
8. **Perfil “cycle”** de simulación (ciclo repetible con duración configurable).

**Largo plazo / opcional:**

9. Modo proxy (DBus/socket) para inyectar datos de otra fuente.
10. Panel “historial de viajes” y reutilización como logs para el Logger.
11. Hardware: pantalla/leds/GPIO para estado o botones de control.

---

## 5. Conclusión

Los sistemas más completos y parecidos al vuestro son **OBDSim** (software, multiplataforma, múltiples ECUs y generadores), **ECUsim 5100** y **Freematics OBD-II Emulator MK2** (hardware listo), y las **plataformas de flota** (telemetría, alertas, geofencing, dashboards). De ellos podéis tomar sobre todo:

- **Funcionalidad:** Logger (reproducción desde log), múltiples ECUs, escenarios exportables, alertas y geofencing básico.
- **Conceptos de producto:** “Escenario” completo (perfil + DTC + valores + ruta), benchmarking y documentación clara de la API.

Con lo que ya tenéis (perfiles ECU, modos 01/02/03/07/0A/09, simulación, GPS NMEA por UART, creador de rutas, mapa), la mayor ganancia sería **reproducción desde log** y **exportar/importar escenario**, seguido de **alertas** y **geofencing** para acercaros al nivel de un sistema tipo “laboratorio + telemetría ligera” sin cambiar el hardware actual.
