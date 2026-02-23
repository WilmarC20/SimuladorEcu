# Hardware — Raspberry Pi 4 (emulador OBD2 + GPS)

Referencia de componentes, conexiones y arranque para el dashboard en la Pi.

---

## 1. Componentes principales

| Componente | Uso |
|------------|-----|
| **Raspberry Pi 4** | Placa principal (2/4/8 GB). Ejecuta el dashboard y emuladores OBD2/GPS. |
| **Fuente 5 V DC** | Mínimo 3 A (USB-C). Alimentación estable. |
| **Tarjeta microSD** | Sistema (Raspberry Pi OS). 16 GB o más. |
| **MCP2515** | Controlador CAN por SPI. Cristal **8 MHz** (revisar en la placa: "8.000"). |
| **Transceptor CAN** | MCP2551 o integrado en el mismo módulo que el MCP2515. Salidas CAN H / CAN L. |
| **Conector OBD2 hembra** | Puerto donde se conecta el lector/ELM327/ESP32. Pines 6 = CAN H, 14 = CAN L, 4 y 5 = GND. |
| **WiFi / Ethernet** | Integrados en la Pi. Dashboard en http://&lt;IP-Pi&gt;:3000 |

---

## 2. Conexiones (Opción B: CAN por GPIO)

- **Pi → MCP2515:** SPI (MOSI 19, MISO 21, SCK 23, CS 24/CE0), INT en GPIO 25 (pin 22), 3.3 V y GND.
- **MCP2515 → OBD hembra:** CAN H → pin **6**, CAN L → pin **14**, GND → pines **4** y **5**.
- **Cristal 8 MHz:** En `/boot/firmware/config.txt`: `dtoverlay=mcp2515-can0,oscillator=8000000,interrupt=25`. Ver [RASPBERRY_MCP2515_CONFIG_8MHZ.md](RASPBERRY_MCP2515_CONFIG_8MHZ.md).
- **Terminación (J1):** En muchos módulos el jumper J1 activa 120 Ω. Con dos nodos en el bus suele ir **sin** J1 en la Pi si el otro nodo ya tiene terminación; si el bus no responde bien, probar **con** J1.

---

## 3. Arranque del bus CAN y del servicio

- **Scripts:** `scripts/ensure-can0-boot.sh` (espera a que exista can0 y lo sube) y `scripts/can0-up.sh` (solo sube can0). Deben tener **finales de línea LF** (no CRLF); si al ejecutar sale "No such file", ejecutar: `sed -i 's/\r$//' scripts/ensure-can0-boot.sh scripts/can0-up.sh` y `chmod +x scripts/*.sh`.
- **Servicio systemd:** `deploy/tracker360-dashboard.service` ejecuta `ExecStartPre=.../ensure-can0-boot.sh` y luego `node index.js`. Instalación: ver [deploy/README.md](../deploy/README.md).
- **Puertos:** 3000 (HTTP dashboard) y 35000 (OBD TCP/BT). Si el servicio no arranca por "puerto en uso", cerrar otras instancias de Node antes de iniciar el servicio.

---

## 4. Documentación relacionada

| Doc | Contenido |
|-----|------------|
| [PINOUT_OBD_HEMBRA_Y_MCP2515.md](PINOUT_OBD_HEMBRA_Y_MCP2515.md) | Pinout OBD2 (6, 14, 4, 5) y pines Pi / MCP2515. |
| [RASPBERRY_MCP2515_CONFIG_8MHZ.md](RASPBERRY_MCP2515_CONFIG_8MHZ.md) | Config overlay 8 MHz, can0, candump, vcan0 vs can0. |
| [DEBUG_ESP32_PI_CAN.md](DEBUG_ESP32_PI_CAN.md) | Checklist cuando no hay comunicación CAN. |
| [deploy/README.md](../deploy/README.md) | Instalación del servicio systemd y script ensure-can0-boot. |

---

## 5. Imágenes en el dashboard

En la página **Hardware (Pi 4)** del dashboard se muestran imágenes de referencia (OBD2, módulo CAN, pines Pi). Cada imagen tiene un botón **"Ver grande"** para abrirla en tamaño ampliado (modal). Cerrar con el botón ×, clic fuera o tecla Escape.
