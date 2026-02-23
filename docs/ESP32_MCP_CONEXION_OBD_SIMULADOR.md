# ESP32 + MCP2515 → Este proyecto (simulador en Raspberry Pi)

El **simulador** es esta misma aplicación en la Raspberry Pi: expone un conector OBD **hembra** por CAN. Tu ESP32 (con MCP2515 y cable **macho**) se conecta a ese hembra. Para que el ESP32 reciba respuestas (p. ej. al enviar `obd 01 0C`), hay que tener CAN activo en la Pi y el cableado correcto.

---

## 1. Qué hace este proyecto por CAN

- La app tiene un **respondedor OBD por CAN** (`lib/obd-can-responder.js`): escucha peticiones en **ID 0x7DF** y responde en **0x7E8** (igual que un ECU).
- Eso solo funciona si en la Pi existe la interfaz **can0** (SocketCAN) y está **UP** a **500 kbps**.

Tu firmware en el ESP32 ya envía bien:
- `obd 01 0C` → envía un frame a **0x7DF** con payload `[2, 0x01, 0x0C, ...]` (longitud + modo 01 + PID 0C).
- El respondedor de la Pi interpreta eso y devuelve la respuesta (RPM, etc.) en **0x7E8**.

---

## 2. Qué necesita la Raspberry Pi

La Pi **no** tiene CAN por defecto. Hace falta:

1. **Hardware CAN** en la Pi, por ejemplo:
   - **Adaptador USB-CAN** (p. ej. basado en SJA1000, MCP2515, etc.): al conectar suele aparecer `can0`.
   - **HAT MCP2515** para Raspberry Pi: hay que habilitar el overlay en `/boot/config.txt` y luego levantar la interfaz.

2. **Conector OBD hembra** conectado a ese hardware:
   - **Pin 6** del OBD hembra → **CAN H** del adaptador/HAT.
   - **Pin 14** del OBD hembra → **CAN L**.
   - **Pines 4 y 5** → **GND** común (Pi + adaptador + OBD).

3. **can0 UP a 500 kbps** antes de arrancar la app:
   ```bash
   sudo ./scripts/can0-up.sh
   ```
   O a mano:
   ```bash
   sudo ip link set can0 down
   sudo ip link set can0 up type can bitrate 500000
   ```

4. **App en marcha** (para que el respondedor OBD esté activo):
   ```bash
   cd ~/dashboard/app && node index.js
   ```
   Si can0 existe y está UP, en la consola debería salir: `OBD CAN responder activo en can0 (7DF → 7E8).`

Si no tienes adaptador USB-CAN ni HAT en la Pi, **can0 no existirá** y el ESP32 nunca recibirá respuesta por CAN (aunque el cableado ESP32 ↔ OBD esté bien).

---

## 3. Cableado ESP32 (macho) ↔ Simulador (hembra)

| Pin OBD2 (macho en el ESP32) | Señal   | Conectar a |
|------------------------------|--------|------------|
| **6**                        | CAN H  | Salida **CAN H** del transceptor (MCP2515/TJA1050) |
| **14**                       | CAN L  | Salida **CAN L** del transceptor |
| **4** y **5**                | GND    | GND común ESP32 + MCP2515 |

El conector **hembra** del simulador (en la Pi) debe tener sus pines 6 y 14 unidos al CAN H y CAN L del hardware CAN de la Pi (y 4/5 a GND).

---

## 4. Tu código ESP32

- **Baudrate 500000** y **0x7DF** para peticiones OBD: correcto para este simulador.
- En tu sketch usas **`PIN_CAN_CS = 22`** (el comentario del principio dice GPIO5). Comprueba que el **CS** del MCP2515 esté realmente en el pin que usa el código (22).
- Si el **SPI test** (`spitest`) responde bien pero no ves tramas RX al enviar `obd 01 0C`, el fallo suele estar en:
  - La Pi sin can0 o can0 no UP.
  - Cableado entre Pi (OBD hembra) y adaptador CAN (H/L y GND).
  - O que el conector macho del ESP32 no tenga 6 y 14 bien conectados al CAN H y CAN L del módulo.

---

## 5. Comprobar en la Pi que CAN funciona

Con el ESP32 conectado al OBD hembra y la app corriendo:

```bash
# Ver si can0 está UP
ip link show can0

# Ver tramas (peticiones 7DF y respuestas 7E8)
candump can0
```

Desde el ESP32 (por Serial) envía `obd 01 0C`. Deberías ver en `candump` una trama 7DF y luego 7E8. En el Serial del ESP32 debería aparecer `[RX] ID=0x7E8 ...`.

---

## 6. Resumen

| Lado        | Qué hacer |
|------------|-----------|
| **Raspberry Pi** | Tener hardware CAN (USB-CAN o HAT) → OBD hembra (6=CAN H, 14=CAN L, 4/5=GND). Ejecutar `sudo ./scripts/can0-up.sh` y luego la app. |
| **ESP32**       | Cable macho: 6=CAN H, 14=CAN L, 4/5=GND. Firmware a 500 kbps, enviar `obd 01 0C` por Serial. |
| **Si no hay respuesta** | Comprobar que en la Pi exista `can0`, que esté UP, que la app haya imprimido "OBD CAN responder activo en can0", y que el cableado OBD (macho y hembra) sea correcto. |
