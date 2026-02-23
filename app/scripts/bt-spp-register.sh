#!/bin/bash
# Registra SPP en el adaptador. Uso: sudo bash scripts/bt-spp-register.sh [hci1]
CHANNEL=1
HCI="$1"
if [ "$(id -u)" -ne 0 ]; then
  echo "Ejecuta con sudo: sudo $0 [hci1]"
  exit 1
fi
if command -v sdptool >/dev/null 2>&1; then
  if [ -n "$HCI" ]; then
    sdptool -i "$HCI" add --channel=$CHANNEL SP 2>/dev/null && echo "SPP registrado en $HCI canal $CHANNEL." || echo "Aviso: sdptool fallo en $HCI."
  else
    sdptool add --channel=$CHANNEL SP 2>/dev/null && echo "SPP registrado en canal $CHANNEL." || echo "Aviso: sdptool fallo."
  fi
else
  echo "sdptool no encontrado. Instala bluez: sudo apt install bluez"
fi
echo ""
echo "Para usar el dongle: OBD_BT_HCI=hci1 node index.js"
