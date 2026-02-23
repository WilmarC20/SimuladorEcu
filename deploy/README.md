# Servicio systemd – Dashboard OBD2

Para que al reiniciar la Raspberry Pi el **bus CAN (can0)** esté UP antes de que arranque la app (y el kiosk cargue la página):

1. Dar permisos de ejecución al script que sube can0 al arranque:
   ```bash
   chmod +x /home/wilmarc/dashboard/scripts/ensure-can0-boot.sh
   ```

2. Instalar el servicio (ajusta la ruta si tu usuario o carpeta son distintos):
   ```bash
   sudo cp /home/wilmarc/dashboard/deploy/tracker360-dashboard.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable tracker360-dashboard.service
   ```

3. Reiniciar el servicio o la Pi:
   ```bash
   sudo systemctl restart tracker360-dashboard.service
   ```

El servicio ejecuta **antes** de Node el script `ensure-can0-boot.sh`, que espera hasta 20 segundos a que exista `can0` (MCP2515) y luego lo sube a 500 kbps. Así la app encuentra el bus ya levantado.

Si tu servicio ya estaba en `/etc/systemd/system/` con otro contenido, reemplázalo con este o añade a tu unidad solo la línea:
`ExecStartPre=+/home/wilmarc/dashboard/scripts/ensure-can0-boot.sh 20 500000`
