# Cómo saber si falla el simulador (OBD hembra) o el ESP32

Pruebas para ver si el problema está en la **Raspberry Pi + conector hembra** o en el **ESP32 + cable macho**.

---

## Prueba A: ¿El simulador (Pi + hembra) envía/recibe CAN?

**Objetivo:** Ver si la Pi tiene CAN activo y si el conector hembra está bien conectado a ese CAN.

### Qué necesitas
- Raspberry Pi con **can0** (USB-CAN o HAT) conectado al **conector OBD hembra** (pines 6 y 14 a CAN H/L).
- Comando `cansend` / `candump` (instalar con `sudo apt install can-utils` si no los tienes).

### Pasos

1. **Subir can0** (desde la raíz del proyecto):
   ```bash
   cd ~/dashboard
   sudo ./scripts/can0-up.sh
   ```
   Si sale "No existe can0", en la Pi **no hay interfaz CAN** o no está configurada. El fallo estaría en el lado del simulador (hardware/config).

2. **Comprobar que can0 está UP:**
   ```bash
   ip link show can0
   ```
   Debe aparecer `state UP`.

3. **Escuchar en la Pi** (en una terminal):
   ```bash
   candump can0
   ```
   Déjalo abierto.

4. **Conectar el ESP32** al conector hembra (cable macho) y, en el Monitor Serie del ESP32, enviar:
   ```
   obd 01 0C
   ```

5. **Resultado:**
   - Si en **candump** aparece una trama **7DF** (y luego 7E8 si la app está corriendo) → el **simulador (hembra + Pi)** recibe y responde; el problema sería más bien en el **ESP32** (no ve la 7E8, o no está enviando bien).
   - Si en **candump** no aparece **nada** → o el ESP32 no está enviando por el cable, o el **conector hembra** (o el cable hasta el chip CAN de la Pi) está mal. Para seguir, haz la Prueba B.

6. **Probar también enviando desde la Pi** (otra terminal):
   ```bash
   cansend can0 7DF#02010C0000000000
   ```
   - Si en **candump** ves la 7DF y una 7E8 (con la app corriendo), el **CAN de la Pi y el respondedor** funcionan. El bus en la Pi está bien; el fallo puede estar en el cable/conector entre hembra y ESP32, o en el ESP32.
   - Si al hacer `cansend` no ves nada en `candump`, el problema está en el **simulador** (can0, driver o cableado al hembra).

---

## Prueba B: ¿El ESP32 (macho + MCP2515) envía por CAN?

**Objetivo:** Ver si el ESP32 realmente manda tramas por el cable macho (pines 6 y 14).

### Opción B1: USB-CAN en un PC (si tienes uno)

1. Conecta un **adaptador USB-CAN** al PC.
2. Conecta el **conector macho** del ESP32 (o un cable OBD macho que salga del MCP2515) a un **conector hembra** que a su vez esté conectado al USB-CAN (pin 6 = CAN H, 14 = CAN L, 4/5 = GND).
3. En el PC: `candump can0` (o el interfaz que use el adaptador).
4. En el ESP32 (Serial): `obd 01 0C`.

Si en el PC **ves la trama 7DF**, el **ESP32 + cable macho** están enviando bien; el fallo estaría en el **simulador (hembra o Pi)**.  
Si **no ves nada** en el PC, el fallo está en el **ESP32** (init, cableado al MCP2515 o al conector macho).

### Opción B2: Sin USB-CAN (solo ESP32 + simulador)

1. En la **Pi**: `sudo ./scripts/can0-up.sh` y `candump can0`.
2. Conecta el **ESP32** al conector **hembra** del simulador.
3. En el ESP32: `obd 01 0C`.

- **Candump muestra 7DF** → el simulador (hembra) **recibe**; el ESP32 **envía**. Si el ESP32 no muestra `[RX] 7E8`, el fallo puede ser: app no corriendo, respuesta 7E8 no llegando al bus, o cable/terminación.
- **Candump no muestra nada** → o el ESP32 no está enviando (revisar init MCP2515 y cableado del ESP32 al macho), o el **hembra** no está bien conectado al CAN de la Pi (pines 6/14, GND).

---

## Resumen

| Prueba | Qué hace | Si falla… |
|--------|----------|-----------|
| **A** | Pi: can0 up, candump, luego enviar con cansend | Sin can0 o sin tramas → problema en **simulador** (hardware/config/cableado hembra). |
| **A** | ESP32 enviando `obd 01 0C` con candump en la Pi | Candump ve 7DF → **hembra + Pi** OK; revisar por qué el ESP32 no ve 7E8. Candump no ve nada → **ESP32 o cable macho/hembra**. |
| **B1** | ESP32 → USB-CAN en PC | PC ve 7DF → **ESP32 + macho** OK; fallo en **simulador**. PC no ve nada → fallo en **ESP32**. |
| **B2** | Solo Pi + ESP32 | Candump ve 7DF = simulador recibe; no ve = problema en envío del ESP32 o en conexión hembra. |

Así puedes saber con claridad si lo que está mal conectado (o mal configurado) es el **simulador (puerto hembra)** o el **ESP32**.
