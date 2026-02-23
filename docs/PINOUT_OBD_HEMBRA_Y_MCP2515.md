# Pinout: OBD hembra (Raspberry) y MCP2515 (ESP32)

Referencia única para comprobar el cableado entre el conector OBD **hembra** de la Pi y el **MCP2515** del ESP32.

---

## 1. Numeración del conector OBD2 (16 pines)

Estándar **SAE J1962**. La numeración se ve desde la **cara del conector** (donde entran los pines del macho):

```
    Vista del HEMBRA (receptáculo) — los números están en el plástico o hay que contarlos así:

         1   2   3   4   5   6   7   8
        ┌───┬───┬───┬───┬───┬───┬───┬───┐
        │   │   │   │ 4 │ 5 │ 6 │   │   │   ← Fila superior
        │   │   │   │GND│GND│CAN│   │   │      Pin 4, 5 = GND
        │   │   │   │   │   │ H │   │   │      Pin 6 = CAN High
        ├───┼───┼───┼───┼───┼───┼───┼───┤
        │   │   │   │   │   │   │   │   │
        │ 9 │10 │11 │12 │13 │14 │15 │16 │   ← Fila inferior
        │   │   │   │   │   │CAN│   │   │      Pin 14 = CAN Low
        └───┴───┴───┴───┴───┴───┴───┴───┘
```

Solo nos importan para CAN:

| Pin OBD2 | Señal (ISO 15765-4) | Uso en este proyecto |
|----------|---------------------|------------------------|
| **4**    | Chassis GND         | GND común              |
| **5**    | Signal GND           | GND común              |
| **6**    | CAN High (J2284)    | CAN H                  |
| **14**   | CAN Low (J2284)     | CAN L                  |

---

## 2. Lado Raspberry Pi: OBD hembra → adaptador CAN (USB-CAN o HAT)

El **conector hembra** está en tu cable o en una base. Cada contacto del hembra (pines 1–16) debe ir al sitio correcto del adaptador CAN de la Pi.

| Pin del OBD hembra | Señal | Conectar a |
|--------------------|--------|------------|
| **6**              | CAN H  | **CAN H** (o CAN_H / CANH) del adaptador USB-CAN o HAT |
| **14**             | CAN L  | **CAN L** (o CAN_L / CANL) del adaptador |
| **4**              | GND    | **GND** del adaptador (y de la Pi) |
| **5**              | GND    | **GND** del adaptador (y de la Pi) |

Importante:
- **No intercambies** 6 y 14: pin 6 siempre CAN H, pin 14 siempre CAN L.
- Los otros pines del hembra (1, 2, 3, 7, 8, 9… 16) no se usan para CAN en este proyecto; puedes dejarlos al aire.

Comprobación con multímetro (sin alimentar):
- Continuidad: **hembra pin 6** ↔ **terminal CAN H del adaptador**.
- Continuidad: **hembra pin 14** ↔ **terminal CAN L del adaptador**.
- Continuidad: **hembra pin 4 y 5** ↔ **GND del adaptador**.

---

## 2b. Pines en la Raspberry Pi (conector de 40 pines)

Depende de si usas **adaptador USB-CAN** o **HAT MCP2515** encima de la Pi.

### Si usas adaptador USB-CAN (dongle por USB)

La Raspberry Pi **no usa ningún pin GPIO para CAN**. El adaptador se conecta por **USB** y crea la interfaz `can0`. Los únicos “pines” que importan son los **terminales del propio dongle** (tornillos o bloque):

- **CAN H** (o H / CAN+) del dongle → cable → **pin 6** del OBD hembra  
- **CAN L** (o L / CAN-) del dongle → cable → **pin 14** del OBD hembra  
- **GND** del dongle → cable → **pines 4 y 5** del OBD hembra  

No hace falta tocar el conector de 40 pines de la Pi para CAN.

---

### Si usas HAT MCP2515 (placa sobre el conector de 40 pines)

El HAT se clava en el **header de 40 pines** de la Pi. La Pi usa **SPI0** y un pin para CS (y a veces INT). Referencia del header (vista con la Pi con el conector hacia arriba, pines hacia ti):

```
    Raspberry Pi – Header 40 pines (solo los usados por un HAT MCP2515 típico)

     Pin físico    GPIO    Señal / Uso
    ───────────   ─────   ─────────────────
        1          -      3.3 V  (alimentación HAT)
        6          -      GND
        9          -      GND
        19         GPIO 10   MOSI (SPI0)
        21         GPIO 9    MISO (SPI0)
        23         GPIO 11   SCK (SPI0)
        24         GPIO 8    CE0 (a menudo CS del MCP2515)
        22         GPIO 25   a veces INT (depende del HAT)
        14         -      GND
        20         -      GND
```

Tabla de referencia (pines de la Pi que suele usar un HAT MCP2515):

| Pin físico (header 40) | GPIO  | Función en CAN (HAT MCP2515) |
|------------------------|-------|------------------------------|
| 1                      | —     | 3.3 V (alimentación del HAT) |
| 6, 9, 14, 20           | —     | GND                          |
| 19                     | 10    | MOSI (SPI0)                  |
| 21                     | 9     | MISO (SPI0)                  |
| 23                     | 11    | SCK (SPI0)                   |
| 24                     | 8     | CE0 (chip select, CS)        |
| 22                     | 25    | INT (interrupción; según HAT) |

El **HAT** trae el MCP2515 y en su placa tiene salidas **CAN H** y **CAN L** (tornillos o pines). Esas salidas son las que debes llevar al conector OBD hembra:

- **CAN H del HAT** → **pin 6** del OBD hembra  
- **CAN L del HAT** → **pin 14** del OBD hembra  
- **GND del HAT** → **pines 4 y 5** del OBD hembra  

Para que aparezca `can0` con un HAT (o MCP2515 por GPIO) hace falta habilitar un overlay en `/boot/firmware/config.txt` (o `/boot/config.txt`). **Si el cristal es 8 MHz** (ej. dice "8.000"): `dtoverlay=mcp2515-can0,oscillator=8000000,interrupt=25`. Si es 16 MHz: `oscillator=16000000`. Luego reiniciar. El overlay ya asigna SPI y CS; tú solo conectas el OBD hembra a los terminales CAN H / CAN L / GND del HAT.

---

## 3. Lado ESP32: MCP2515 → conector OBD macho

El **módulo MCP2515** suele traer el transceptor integrado y dos salidas etiquetadas **CANH** y **CANL** (o CAN_H / CAN_L). Esas salidas van al conector **macho** que luego insertas en el hembra de la Pi.

| Pin del OBD macho | Señal | Conectar a |
|-------------------|--------|------------|
| **6**             | CAN H  | **CANH** (o CAN_H) del módulo MCP2515 |
| **14**            | CAN L  | **CANL** (o CAN_L) del módulo MCP2515 |
| **4**             | GND    | **GND** del MCP2515 (y del ESP32) |
| **5**             | GND    | **GND** del MCP2515 (y del ESP32) |

Cuando enchufas macho en hembra:
- Macho 6 entra en hembra 6 → CAN H con CAN H.
- Macho 14 entra en hembra 14 → CAN L con CAN L.
- Macho 4 y 5 con hembra 4 y 5 → GND común entre Pi y ESP32.

Comprobación con multímetro:
- Continuidad: **macho pin 6** ↔ **pad/pin CANH del MCP2515**.
- Continuidad: **macho pin 14** ↔ **pad/pin CANL del MCP2515**.
- Continuidad: **macho pin 4 o 5** ↔ **GND del MCP2515**.

---

## 4. Resumen visual del bus CAN (Pi ↔ ESP32)

```
  Raspberry Pi                    Cable OBD                     ESP32
  ─────────────                   ─────────                     ─────

  USB-CAN / HAT                   Conector                      MCP2515
  ┌─────────────┐                 hembra ◄──── macho            ┌─────────────┐
  │ CAN H ──────┼────(cable)────── Pin 6 ◄─── Pin 6 ────────────┼── CANH      │
  │ CAN L ──────┼────(cable)────── Pin 14 ◄── Pin 14 ───────────┼── CANL      │
  │ GND   ──────┼────(cable)────── Pin 4,5 ◄─ Pin 4,5 ─────────┼── GND       │
  └─────────────┘                 (OBD2)                       └─────────────┘
```

Si tu adaptador en la Pi tiene tornillos o bloques de terminales, suele haber etiquetas como **H** / **L** o **CAN+** / **CAN-**:
- **H** o **CAN+** = CAN H → debe ir al **pin 6** del hembra.
- **L** o **CAN-** = CAN L → debe ir al **pin 14** del hembra.

---

## 5. Pines del MCP2515 hacia el ESP32 (SPI)

Por si lo necesitas para revisar el lado ESP32 (init, SPI):

| Módulo MCP2515 | Conectar a (ESP32) |
|----------------|--------------------|
| VCC            | 3.3 V              |
| GND            | GND                |
| CS             | GPIO 5 **o** 22 (según tu código: revisar `PIN_CAN_CS`) |
| SO (MISO)      | GPIO 19            |
| SI (MOSI)      | GPIO 23            |
| SCK            | GPIO 18            |
| INT            | GPIO 4             |
| **CANH**       | → OBD macho **pin 6**  |
| **CANL**       | → OBD macho **pin 14** |

En el diagrama del Tracker360 se usa CS=5; en tu sketch se mencionó CS=22. Comprueba en el código qué GPIO usas y que el cable CS del módulo vaya a ese pin.

---

## 6. Checklist rápido de cableado

- [ ] OBD **hembra** pin **6** → CAN **H** del adaptador de la Pi.
- [ ] OBD **hembra** pin **14** → CAN **L** del adaptador de la Pi.
- [ ] OBD **hembra** pin **4 y 5** → **GND** del adaptador de la Pi.
- [ ] OBD **macho** pin **6** ← **CANH** del MCP2515.
- [ ] OBD **macho** pin **14** ← **CANL** del MCP2515.
- [ ] OBD **macho** pin **4 y 5** ← **GND** del MCP2515/ESP32.
- [ ] Al conectar macho en hembra, GND común entre Pi y ESP32 (continuidad entre GND Pi y GND ESP32 por los pines 4/5).

Si algo no coincide, revisa con el multímetro continuidad en cada uno de estos puntos.
