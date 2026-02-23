# Simulador ECU OBD2 — Estándares y estado de implementación

Este documento describe qué normas y protocolos utiliza el simulador, qué está implementado y qué mejoras tienen sentido a medio plazo. Sirve como referencia técnica y como guía para futuras extensiones.

---

## 1. Normas y siglas de referencia

Antes de entrar en modos y PIDs, conviene tener claro a qué hace referencia cada estándar:

| Norma / sigla | Qué es y para qué sirve |
|---------------|-------------------------|
| **SAE J1979** | Norma SAE que define los **modos de diagnóstico** (servicios 01–0A) y los **PIDs del modo 01** (parámetros en vivo del motor). Es la base de OBD-II en EE. UU. y de facto a nivel internacional. Define estructura de petición/respuesta y fórmulas de codificación de los PIDs. |
| **SAE J2012** | Define la **estructura y significado de los códigos DTC** (Diagnostic Trouble Code): formato de 5 caracteres (P/C/B/U + 4 dígitos), rangos (P0xxx, P1xxx, P2xxx, etc.) y su interpretación. Equivalente técnico a ISO 15031-6. |
| **ISO 15031-5** | Norma ISO para **servicios de diagnóstico relacionados con emisiones**. Cubre los mismos modos que J1979 (petición de datos, DTC, borrado, información de vehículo, etc.) y es la referencia en muchos mercados fuera de EE. UU. |
| **ISO 15031-6** | Especifica las **definiciones de los códigos de fallo** (DTC) en formato estándar. Equivalente a SAE J2012. |
| **ISO 15765-2** | Protocolo de **transporte de mensajes largos sobre CAN** (también llamado **ISO-TP** o **CAN-TP**). Define cómo fragmentar respuestas de más de 7 bytes en varios frames (First Frame, Consecutive Frame, Flow Control). OBD-II sobre CAN lo usa cuando la respuesta no cabe en un solo frame (p. ej. VIN completo en un solo mensaje). |
| **SAE J2190** | Norma que añade **servicios extendidos** (p. ej. modo **22**) usados por algunos fabricantes (Ford, GM) para PIDs propietarios. No es obligatoria para un simulador genérico. |
| **OBD-II** | Denominación comercial/reglamentaria del sistema de diagnóstico a bordo obligatorio en vehículos (desde 1996 en EE. UU., y equivalente en otras regiones). En la práctica se apoya en J1979, J2012 e ISO 15031. |
| **CALID** | Calibration ID: identificador de la **versión de calibración/software** de la ECU. Se consulta con modo 09, PID 04. |
| **CVN** | Calibration Verification Number: **número de verificación** (checksum) de la calibración. Se consulta con modo 09, PID 06. Sirve para detectar modificaciones del software de la ECU. |

---

## 2. Servicios (modos) OBD-II según SAE J1979 / ISO 15031-5

Los **servicios** (antes llamados “modos”) son el primer byte de la petición: 01 = datos en vivo, 02 = freeze frame, 03 = DTC almacenados, etc. La siguiente tabla indica qué soporta hoy el simulador.

| Modo | Nombre | Descripción breve | Estado en el simulador |
|------|--------|-------------------|------------------------|
| **01** | Show current data | PIDs en vivo (RPM, velocidad, temperatura, etc.). Respuesta con prefijo **41**. | ✅ **Implementado.** PIDs definidos por perfil ECU; bitmap 0100/0120/0140 generado dinámicamente. |
| **02** | Show freeze frame data | Snapshot de parámetros en el momento en que se guardó un DTC. Respuesta con prefijo **42**. | ✅ **Implementado.** Se guarda una freeze frame al activar un DTC; PID 02 devuelve el DTC que la provocó. |
| **03** | Stored DTCs | Códigos de fallo almacenados. Respuesta **43** + lista de DTC codificados. | ✅ **Implementado.** |
| **04** | Clear DTCs and stored values | Borrado de DTC y valores almacenados. Respuesta **44**. | ✅ **Implementado.** |
| **05** | Test results, O2 monitoring | Resultados de tests de sensores O2 (típico en buses no CAN). | ❌ No implementado. |
| **06** | Test results, other monitoring | Resultados de monitores (continuos/no continuos) en CAN. | ❌ No implementado. |
| **07** | Pending DTCs | Códigos pendientes (detectados en el ciclo actual o anterior). Respuesta **47**. | ✅ **Implementado.** |
| **08** | Control operation of component | Control de actuadores (no solo lectura). | ❌ No implementado (modo de control). |
| **09** | Request vehicle information | VIN, CALID, CVN y datos relacionados. Respuesta con prefijo **49**. | ✅ **Implementado.** VIN en 5 frames (4 bytes/frame), CALID corto, CVN 4 bytes. Configurable con `setVehicleInfo()`. |
| **0A** | Permanent DTCs | DTC permanentes (cleared DTCs). Respuesta **4A**. | ✅ **Implementado.** |

---

## 3. Detalle de lo implementado

### 3.1 Modo 02 — Freeze frame (SAE J1979 / ISO 15031-5)

- **Qué es:** Una “foto” de las condiciones del motor (RPM, velocidad, temperaturas, etc.) en el instante en que se almacenó un DTC. Las herramientas de diagnóstico la usan para analizar el fallo.
- **Petición:** Servicio **02** + PID (2 bytes) y, opcionalmente, número de frame (3.º byte).
- **Respuesta:** Prefijo **42** + mismo PID + datos codificados como en modo 01, pero usando los valores congelados. El **PID 02** en modo 02 devuelve el DTC que provocó el freeze (2 bytes codificados).
- **En el simulador:** En `obd-engine.js`, al activar un DTC se guarda `freezeFrameData` (copia de los datos actuales del motor). Las peticiones 02 se responden con ese snapshot; TCP y CAN soportan modo 02.

### 3.2 Modo 09 — Información del vehículo (VIN, CALID, CVN)

- **Qué es:** Permite leer el **VIN** (17 caracteres), el **CALID** (identificador de calibración) y el **CVN** (número de verificación). Obligatorio en muchos mercados desde 2005 para inspección y verificación de software.
- **Implementación actual:**
  - **09 00:** Bitmap de PIDs soportados en modo 09 (02, 04, 06).
  - **09 02:** VIN. Respuesta inicial `49 02 01 11`; los 17 bytes se envían en 5 tramas (4+4+4+4+1) con peticiones `09 02 01` … `09 02 05`.
  - **09 04:** CALID (cadena corta, hasta 4 bytes en un frame).
  - **09 06:** CVN (4 bytes en hexadecimal).
- **Configuración:** Valores por defecto en `vehicleInfo`; se pueden cambiar con `setVehicleInfo(vin, calid, cvn)`.

### 3.3 ISO 15765-2 (ISO-TP) y respuestas largas

- **Qué es:** **ISO 15765-2** (ISO-TP) es el protocolo de transporte que permite enviar mensajes de más de 7 bytes de datos sobre CAN, usando First Frame (FF), Consecutive Frames (CF) y Flow Control (FC).
- **Dónde importa:** VIN largo en un solo flujo, algunos PIDs de modo 09 y servicios UDS (p. ej. servicio 22) cuando la respuesta supera un frame.
- **Estado:** El simulador responde hoy solo con **single frame**. El VIN se reparte en varias peticiones 09 02 01 … 05, por lo que no se requiere ISO-TP para el caso actual. Una mejora futura sería soportar multi-frame para respuestas largas en un solo mensaje.

---

## 4. PIDs modo 01 (SAE J1979)

- **Qué es:** Los **PIDs** (Parameter IDs) del modo 01 son códigos de 1 byte (01–FF) que identifican cada parámetro en vivo (carga, RPM, temperatura, etc.). J1979 define rangos ($01–$20, $21–$40, etc.) y las fórmulas para codificar/decodificar los valores.
- **En el simulador:** El **catálogo** en `ecu-profile-catalog.js` incluye decenas de PIDs estándar (04, 05, 0C, 0D, 0F, 2F, 10–1F, 21–3F, 41–69, etc.). El **perfil ECU** define qué PIDs soporta cada “vehículo”; los bitmap 0100/0120/0140 se generan a partir de ese perfil. Se puede seguir ampliando el catálogo (rangos 61–80, 81–A0, etc.) según J1979 o tablas de referencia.

---

## 5. Códigos DTC (SAE J2012 / ISO 15031-6)

- **Qué es:** Los **DTC** (Diagnostic Trouble Code) siguen una estructura de 5 caracteres: letra (P = powertrain, C = chassis, B = body, U = network) + 4 dígitos. SAE J2012 e ISO 15031-6 definen rangos y significados (P0xxx controlados por ISO/SAE, P1xxx por fabricante, etc.).
- **En el simulador:** Se respetan formato y rangos; el catálogo del creador de perfiles incluye una lista amplia de códigos estándar. Los modos 03, 07 y 0A devuelven los DTC almacenados, pendientes y permanentes según esa estructura.

---

## 6. Modos 21 / 22 (fabricante)

- **Qué son:** Servicios **extendidos** por fabricante: **modo 21** (p. ej. Toyota), **modo 22** (SAE J2190, Ford/GM). Dan acceso a PIDs propietarios no cubiertos por J1979.
- **Estado:** No implementados. Una extensión futura podría definir un bloque “manufacturer PIDs” en el perfil ECU y responder 21/22 según ese bloque; no es prioritario para un simulador genérico.

---

## 7. Resumen de prioridades

| Prioridad | Tema | Esfuerzo | Notas |
|-----------|------|----------|--------|
| — | Modo 02 freeze frame | — | **Implementado** |
| — | Modo 09 (VIN, CALID, CVN) | — | **Implementado** |
| **Media** | Ampliar catálogo PIDs (41–60, 61–80, etc.) | Medio | Mejora el creador de perfiles sin cambiar arquitectura. |
| **Baja** | ISO-TP multi-frame para respuestas largas | Alto | Útil para VIN en un solo mensaje o UDS. |
| **Baja** | Modos 21/22 (PIDs fabricante) | Medio | Solo si se simulan marcas concretas. |

---

## 8. Referencias

- **SAE J1979** — E/E Diagnostic Test Modes (modos 01–0A, PIDs modo 01).
- **SAE J2012** — Diagnostic Trouble Code Definitions (estructura DTC).
- **SAE J2190** — Extended diagnostic services (modo 22, etc.).
- **ISO 15031-5** — Road vehicles — Communication between vehicle and external equipment — Emissions-related diagnostic services.
- **ISO 15031-6** — DTC definitions (equivalente a J2012).
- **ISO 15765-2** — Road vehicles — Diagnostic communication over CAN — Transport protocol (ISO-TP).
- **Wikipedia:** OBD-II PIDs (tabla detallada modo 01 y otros).
- **x-engineer.org:** Mode 01, Mode 02 (freeze frame).

Este documento se puede actualizar según se implementen o descarten mejoras en el simulador.
