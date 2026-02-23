#!/bin/bash
# Levanta la interfaz CAN (can0) a 500 kbps para el respondedor OBD2.
# Requiere: interfaz CAN en la Pi (USB-CAN o HAT MCP2515) y drivers/socketcan.
# Uso: sudo ./scripts/can0-up.sh

set -e
BITRATE="${1:-500000}"

if ! ip link show can0 &>/dev/null; then
  echo "No existe can0. ¿Tienes un adaptador USB-CAN o HAT MCP2515?"
  echo "  - USB-CAN: suele crear can0 al conectar (kernel module)."
  echo "  - MCP2515: configurar en /boot y cargar overlay (dtparam=spi=on, dtoverlay=mcp2515-can0)."
  exit 1
fi

ip link set can0 down 2>/dev/null || true
ip link set can0 up type can bitrate "$BITRATE"
echo "can0 UP @ $BITRATE bps. Conecta el ESP32 por OBD y envíale 'obd 01 0C'."
