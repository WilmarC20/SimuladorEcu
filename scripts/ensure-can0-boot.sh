#!/bin/bash
# Espera a que can0 exista (overlay MCP2515 al arranque) y lo sube a 500 kbps.
# Uso: sudo scripts/ensure-can0-boot.sh
# Lo usa el servicio systemd para que el bus esté UP antes de arrancar la app.

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CAN0_UP="$SCRIPT_DIR/can0-up.sh"
MAX_WAIT="${1:-20}"
BITRATE="${2:-500000}"

for i in $(seq 1 "$MAX_WAIT"); do
  if ip link show can0 &>/dev/null; then
    exec "$CAN0_UP" "$BITRATE"
  fi
  sleep 1
done

# No fallar el servicio: la app arranca igual; CAN quedará down hasta subir can0 a mano
echo "ensure-can0-boot: can0 no apareció en ${MAX_WAIT}s. La app arrancará sin CAN. Subir a mano: sudo $CAN0_UP" >&2
exit 0
