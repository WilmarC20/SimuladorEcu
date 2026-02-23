# MCP2515 init fallo (code=1) — qué revisar

Cuando el ESP32 muestra:
- `Entering Configuration Mode Failure...`
- `[CAN] MCP2515 init fallo final, code=1`

el MCP2515 **no está respondiendo** al SPI. Revisa en este orden:

---

## 1. Ejecutar `spitest`

En el Monitor Serie del ESP32 escribe:

```
spitest
```

- Si sale **`[SPITEST] ERROR: bus SPI parece flotante (0x00/0xFF)`** → el MCP2515 no responde: fallo de cableado, alimentación o CS.
- Si sale **`[SPITEST] ERROR: lectura/escritura no consistente`** → SPI parcial (p. ej. MISO/MOSI cruzados o CS incorrecto).
- Si sale **`[SPITEST] OK`** → el SPI funciona; el fallo puede ser solo el cristal (8 vs 16 MHz) o el modo CAN; en ese caso prueba con otro cristal en el código o revisa la placa.

---

## 2. Cableado ESP32 ↔ MCP2515

Tu código usa:

| Señal | GPIO | Conectar a |
|-------|------|------------|
| SCK   | 18   | SCK del módulo MCP2515 |
| MISO  | 19   | SO (MISO) del módulo   |
| MOSI  | 23   | SI (MOSI) del módulo   |
| CS    | **22** | CS del módulo        |
| INT   | 4    | INT del módulo (opcional) |
| 3.3 V | 3V3  | VCC del módulo        |
| GND   | GND  | GND del módulo        |

Comprueba con el multímetro (continuidad):

- GPIO 22 (ESP32) → pin **CS** del MCP2515 (no otro pin).
- 18 → SCK, 19 → SO/MISO, 23 → SI/MOSI.
- **GND común** entre ESP32 y módulo (imprescindible).
- Si el módulo es de 5 V, alimentarlo a 5 V pero **no** conectar 5 V a pines del ESP32 (solo 3.3 V en los GPIO).

---

## 3. Probar otro pin para CS (p. ej. 5)

Muchos módulos y ejemplos usan **GPIO 5** para CS. Si tu cable está en el pin 5 pero el código dice 22, fallará.

Prueba en el código:

```cpp
static const int PIN_CAN_CS = 5;   // en lugar de 22
```

Sube el sketch y prueba de nuevo. Si con 5 funciona, tu módulo está cableado a GPIO 5.

---

## 4. Comprobar alimentación

- El MCP2515 debe tener **VCC estable** (3.3 V o 5 V según la placa).
- Si usas breadboard, comprueba que 3V3 y GND lleguen bien al módulo (sin conexión floja).

---

## 5. No intercambiar MISO y MOSI

- **MISO** (Master In Slave Out): dato **desde** el MCP2515 **hacia** el ESP32 → pin **SO** del módulo a **GPIO 19**.
- **MOSI** (Master Out Slave In): dato **desde** el ESP32 **hacia** el MCP2515 → pin **SI** del módulo a **GPIO 23**.

Si los tienes cruzados, a veces `spitest` falla en lectura/escritura.

---

## 6. Resumen rápido

| Paso | Acción |
|------|--------|
| 1 | Ejecutar `spitest` en el Monitor Serie. |
| 2 | Revisar que **CS** vaya realmente al pin que usa el código (22 o 5). |
| 3 | Comprobar GND común y VCC al MCP2515. |
| 4 | Probar `PIN_CAN_CS = 5` si el cable está en el pin 5. |

Cuando `spitest` responda OK, el `canStart()` debería poder inicializar a 8 o 16 MHz.
