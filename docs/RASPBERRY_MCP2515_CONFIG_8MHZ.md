# Configurar MCP2515 en Raspberry Pi (cristal 8 MHz)

Si tu módulo MCP2515 tiene un **cristal de 8 MHz** (dice "8.000" en el cristal), la configuración del overlay debe usar **oscillator=8000000**. Si pones 16 MHz por error, el bitrate real será incorrecto y **no verás tramas** en `candump` ni en la app.

---

## 1. Editar la configuración de arranque

En la Raspberry Pi:

```bash
sudo nano /boot/firmware/config.txt
```

En Raspberry Pi OS antiguos el archivo puede ser `/boot/config.txt`. Comprueba con `ls /boot/firmware/config.txt 2>/dev/null || ls /boot/config.txt`.

Al final del archivo (o en la sección `[all]`), asegúrate de tener **exactamente**:

```ini
# SPI para MCP2515
dtparam=spi=on

# MCP2515 CAN0 — cristal 8 MHz (si tu cristal dice 8.000, usa 8000000)
dtoverlay=mcp2515-can0,oscillator=8000000,interrupt=25
```

- **oscillator=8000000** → obligatorio para cristal de **8 MHz**.
- **interrupt=25** → GPIO 25 (pin físico 22). El cable **INT** (amarillo) del MCP2515 debe ir a **GPIO 25** en la Pi.

Si tu cristal fuera de 16 MHz, usarías `oscillator=16000000`.

Guarda (Ctrl+O, Enter) y cierra (Ctrl+X).

---

## 2. Reiniciar la Pi

```bash
sudo reboot
```

El overlay se carga al arranque. Sin reinicio no aplica.

---

## 3. Comprobar que existe can0

Tras el reinicio:

```bash
ip link show can0
ip -details link show can0
```

Deberías ver la interfaz y en los detalles algo como `clock 8000000` (cristal correcto). Si no existe `can0`, el overlay no se cargó: revisa `dmesg | grep -i mcp2515` y que la línea de `dtoverlay` esté bien escrita.

**Si ves `can state BUS-OFF`:** el controlador entró en bus-off (por ejemplo tras enviar sin otro nodo que responda ACK). Para recuperar:

```bash
sudo ip link set can0 down
sudo ip link set can0 up type can bitrate 500000
```

O ejecuta de nuevo: `sudo ~/dashboard/scripts/can0-up.sh`

---

## 4. Subir can0 a 500 kbps

```bash
sudo ip link set can0 down
sudo ip link set can0 up type can bitrate 500000
```

O desde el proyecto:

```bash
sudo ~/dashboard/scripts/can0-up.sh
```

---

## 5. Probar que la Pi recibe tramas (ELM327 + Torque)

1. Conecta el **ELM327** al conector **hembra** (pines 6 y 14 a CAN H/L, 4 y 5 a GND).
2. En la Pi, en una terminal:

   ```bash
   candump can0
   ```

3. Desde el móvil, abre **Torque** y envía una petición OBD (por ejemplo, RPM o velocidad).

Si la configuración es correcta (8 MHz, can0 up, cableado bien), en `candump` deberías ver tramas **7DF** (petición) y posiblemente **7E8** (respuesta del ELM327 o de otro nodo).

Si **no aparece nada** en `candump`:
- Confirma que en `config.txt` está **oscillator=8000000** (no 16000000).
- Reinicia la Pi después de cambiar `config.txt`.
- Comprueba cableado: hembra pin 6 → CAN H del módulo, pin 14 → CAN L, 4 y 5 → GND.
- Comprueba que el cable **INT** del MCP2515 va a **GPIO 25** (pin 22) de la Pi.

---

## 6. Arrancar la app (respondedor OBD)

Cuando `candump` ya muestre tráfico:

```bash
cd ~/dashboard/app && node index.js
```

Debería salir: `OBD CAN responder activo en can0 (7DF → 7E8).`  
La app responderá a las peticiones 7DF con respuestas en 7E8 (igual que un ECU). Si quieres ver en consola cada trama recibida, se puede añadir un log en el respondedor.

---

## Resumen

| Paso | Acción |
|------|--------|
| 1 | En `/boot/firmware/config.txt`: `dtparam=spi=on` y `dtoverlay=mcp2515-can0,oscillator=8000000,interrupt=25` |
| 2 | `sudo reboot` |
| 3 | `ip link show can0` (debe existir) |
| 4 | `sudo ip link set can0 up type can bitrate 500000` |
| 5 | `candump can0` y enviar desde Torque con ELM327 en el hembra → deben verse tramas |
| 6 | `node index.js` en `app/` para el respondedor OBD |

El fallo más común con cristal 8 MHz es tener **oscillator=16000000** en la config: con eso el bus no sincroniza y no verás datos en la consola.

---

## vcan0 vs can0 — por qué no ves lo del puerto hembra

| Interfaz | Qué es | Conectado al puerto hembra |
|----------|--------|----------------------------|
| **vcan0** | CAN **virtual** (solo en la Pi) | **No** — no sale al MCP2515 ni al conector OBD |
| **can0** | CAN **real** (MCP2515) | **Sí** — es el bus del puerto hembra |

- Si haces `cansend vcan0 7DF#...` y `candump vcan0` en otra terminal, ves las tramas porque es todo dentro de la Pi (loopback virtual).
- Eso **no** llega al puerto hembra. El hembra está en **can0** (el MCP2515 físico).

Para ver y enviar tráfico por el **puerto hembra** (ELM327, ESP32, etc.):

1. Subir la interfaz **real**:  
   `sudo ip link set can0 down; sudo ip link set can0 up type can bitrate 500000`
2. Ver tráfico del hembra:  
   `candump can0`   ← **can0**, no vcan0
3. Enviar por el hembra (con otro nodo conectado, p. ej. ELM327):  
   `cansend can0 7DF#0201050000000000`   ← **can0**, no vcan0

La app del dashboard escucha en **can0**; si usas vcan0, la app no ve ese tráfico ni responde por el hembra.
