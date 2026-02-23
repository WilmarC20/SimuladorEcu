# Cómo pedir sensores OBD2 e interpretar las respuestas

Documento para quien tiene un proyecto (p. ej. Arduino) que se conecta a una ECU por ELM327 (Bluetooth o serial). Explica solo el protocolo: cómo se piden los sensores y cómo se interpretan los bytes que devuelve la ECU.

---

## Texto de referencia (protocolo OBD2)

```
Tu proyecto se conecta a una ECU OBD2 por ELM327 (Bluetooth o serial). La ECU responde en estándar OBD-II modo 01 (datos en tiempo real). Esto describe cómo PEDIR cada sensor y cómo INTERPRETAR la respuesta (qué bytes llegan y qué valor real representan).

——— CÓMO PEDIR UN SENSOR ———

Por el ELM se envía un comando con dos partes:
- Modo: 01 (datos en tiempo real).
- PID: identificador del sensor en hex (2 caracteres).

Comando típico que envías al ELM (en texto): "01 0C" para pedir RPM, "01 0D" para velocidad, etc. El ELM lo convierte a CAN/OBD y la ECU responde.

PIDs de modo 01 que puedes pedir (y qué sensor es):

  01 00 — Consulta qué PIDs 01-20 soporta la ECU (informativo).
  01 01 — Estado del monitor (informativo).
  01 04 — Carga del motor (%).
  01 05 — Temperatura del refrigerante (°C).
  01 0C — RPM (revoluciones por minuto).
  01 0D — Velocidad del vehículo (km/h).
  01 0F — Temperatura del aire de admisión (°C).
  01 2F — Nivel de combustible (%).

Solo tienes que enviar el comando "01 XX" (modo 01 + PID). La respuesta que recibes por el ELM son bytes en hex; a partir de ahí hay que interpretarlos.

——— CÓMO INTERPRETAR LA RESPUESTA ———

La ECU responde con:
- Byte 0: siempre 41 (es el modo 01 + 0x40; confirma modo 01).
- Byte 1: el PID que pediste (ej. 0C, 0D).
- Bytes siguientes: los DATOS del sensor. Su número y significado dependen del PID.

Fórmulas para obtener el valor real a partir de los bytes de datos (A = primer byte de datos, B = segundo si hay dos):

  01 00 — 4 bytes de máscara (informativo; no es un valor físico).
  01 01 — 4 bytes de estado (informativo).

  01 04 — Carga motor (%)
    Datos: 1 byte (A).
    Valor: carga_pct = (A * 100) / 255.
    Rango: 0–100 %.

  01 05 — Temperatura refrigerante (°C)
    Datos: 1 byte (A).
    Valor: temperatura_C = A - 40.
    Rango típico: -40 a 215 °C.

  01 0C — RPM
    Datos: 2 bytes en este orden: A = byte alto, B = byte bajo (big-endian).
    Valor: rpm = (A * 256 + B) / 4.
    Ejemplo: respuesta 41 0C 0C D0 → A=0x0C=12, B=0xD0=208 → (12*256+208)/4 = 3280/4 = 820 rpm.

  01 0D — Velocidad (km/h)
    Datos: 1 byte (A).
    Valor: velocidad_kmh = A (el byte es directamente los km/h).
    Rango: 0–255 km/h.

  01 0F — Temperatura aire admisión (°C)
    Datos: 1 byte (A).
    Valor: temperatura_C = A - 40.

  01 2F — Nivel combustible (%)
    Datos: 1 byte (A).
    Valor: nivel_pct = (A * 100) / 255.
    Rango: 0–100 %.

——— RESUMEN ———

- Pedir sensor: enviar "01" + PID (ej. "01 0C" para RPM).
- Respuesta: 41 + PID + uno o más bytes de datos.
- Interpretar: aplicar la fórmula del PID (restar 40 en temperaturas; (A*256+B)/4 en RPM; (A*100)/255 en porcentajes; velocidad = byte directo).
```

---

## Referencia rápida (misma información en tabla)

| PID  | Sensor              | Bytes datos | Cómo interpretar              |
|------|---------------------|-------------|-------------------------------|
| 01 00 | PIDs soportados     | 4           | Informativo                   |
| 01 04 | Carga motor %       | 1 (A)       | % = (A×100)/255               |
| 01 05 | Temp. refrigerante  | 1 (A)       | °C = A − 40                   |
| 01 0C | RPM                 | 2 (A,B)     | RPM = (A×256+B)/4             |
| 01 0D | Velocidad           | 1 (A)       | km/h = A                      |
| 01 0F | Temp. admisión      | 1 (A)       | °C = A − 40                   |
| 01 2F | Nivel combustible   | 1 (A)       | % = (A×100)/255               |
