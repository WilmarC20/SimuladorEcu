#!/bin/bash
# Arranca el dashboard usando el dongle Bluetooth (hci1) para OBD2 SPP.
# Así los clientes que se conectan por MAC e0:ad:47:20:31:e3 encontrarán SPP.
cd "$(dirname "$0")"
export OBD_BT_HCI=hci1
exec node index.js "$@"
