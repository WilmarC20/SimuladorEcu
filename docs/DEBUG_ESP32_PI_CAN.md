# Todo conectado y sigue sin funcionar — checklist

Sigue estos pasos en orden y anota qué ves en cada uno.

---

## 1. ¿El ESP32 inicializa el MCP2515?

En el **Monitor Serie del ESP32** (115200), al encender o resetear:

- ¿Sale **`[CAN] MCP2515 OK @ 500000 bps`**? → Sigue al paso 2.
- ¿Sale **`[CAN] MCP2515 init fallo final, code=1`**? → El ESP32 no está en el bus. Revisa cableado ESP32↔MCP2515 (CS, SCK, MISO, MOSI, GND) y prueba `spitest` y CS en GPIO 5 o 22 según tengas cableado. No sigas hasta que init sea OK.

---

## 2. Con ESP32 conectado al hembra: ¿la Pi ve la 7DF?

**En la Pi:**

- Terminal 1: `candump can0` (déjalo corriendo).
- La app debe estar corriendo: `cd ~/dashboard/app && node index.js`.

**En el ESP32** (Monitor Serie): escribe

```
obd 01 0C
```

**En la terminal de candump:**

- **Si aparece una trama 7DF** → La Pi recibe lo que envía el ESP32. El cable macho→hembra y el bus están bien hasta la Pi. Pasa al paso 3.
- **Si no aparece nada** → La Pi no recibe. Revisa:
  - Conector macho del ESP32: pin 6 = CAN H del módulo, pin 14 = CAN L, pines 4 y 5 = GND.
  - Que el hembra de la Pi tenga 6 y 14 unidos al CAN H y CAN L del adaptador USB-CAN (no a otro sitio).
  - Contacto macho–hembra (pines limpios, bien insertados).

---

## 3. ¿La Pi responde con 7E8?

Mismo montaje que en el paso 2 (candump corriendo, app corriendo, ESP32 conectado).

Después de enviar `obd 01 0C` desde el ESP32:

**En candump:**

- **Si aparece una trama 7E8** después de la 7DF → La app está respondiendo y la respuesta sale al bus. Pasa al paso 4.
- **Si solo ves 7DF y no 7E8** → La app no está enviando o can0 no está bien. Comprueba que en la consola de `node index.js` haya salido "OBD CAN responder activo en can0". Reinicia can0 (`sudo ip link set can0 down` y luego `up`) y la app.

---

## 4. ¿El ESP32 recibe la 7E8?

Mismo prueba que antes (candump + app + `obd 01 0C` desde el ESP32).

**En el Monitor Serie del ESP32:**

- **Si aparece `[RX] ID=0x7E8 ...`** → Todo el camino CAN (ESP32 ↔ Pi) funciona.
- **Si candump sí muestra 7E8 pero el ESP32 no muestra [RX]** → La 7E8 llega al adaptador de la Pi pero no al ESP32. Revisa:
  - Que en el hembra de la Pi, los pines 6 y 14 vayan realmente al CAN H y CAN L del USB-CAN (no invertidos, no a otros pines).
  - Que el conector macho del ESP32 haga buen contacto con 6 y 14 del hembra (prueba con otro cable OBD si puedes).
  - GND común: pines 4 y 5 del OBD a GND en ambos lados.

---

## 5. Comprobar GND común

Con **todo apagado** y multímetro en continuidad:

- GND del **ESP32** (o del MCP2515) ↔ **Pin 4 o 5 del conector macho** del ESP32 → debe dar continuidad.
- Esos mismos pines (4 o 5) del **hembra de la Pi**, cuando está conectado al macho del ESP32, deben tener continuidad con el **GND del USB-CAN / Pi**. Si no hay continuidad, el GND del bus no está unido y el CAN no funcionará bien.

---

## Resumen rápido

| Paso | Qué comprobar | Si falla |
|------|----------------|----------|
| 1 | ESP32: "[CAN] MCP2515 OK" | Arreglar init (CS, SPI, spitest) |
| 2 | candump muestra 7DF al enviar desde ESP32 | Cableado macho (6/14) y hembra (6/14) al CAN H/L |
| 3 | candump muestra 7E8 tras 7DF | App y can0 (reiniciar can0 y app) |
| 4 | ESP32 muestra [RX] 7E8 | Hembra bien conectada al USB-CAN; contacto 6/14; GND común |
| 5 | GND común Pi ↔ ESP32 por OBD 4/5 | Unir GND en el cable/conector |

Cuando digas en qué paso te quedas (y qué ves en cada uno), se puede afinar el fallo.
