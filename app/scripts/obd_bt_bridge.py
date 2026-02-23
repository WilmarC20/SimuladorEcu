#!/usr/bin/env python3
"""
Puente Bluetooth SPP -> TCP local (puerto 35000).
Para usar el DONGLE (hci1) en lugar del Bluetooth de la Pi (hci0), ejecuta con:
  OBD_BT_HCI=hci1 python3 obd_bt_bridge.py
o registra SPP en el dongle: sudo scripts/bt-spp-register.sh hci1

Uso: python3 obd_bt_bridge.py [puerto_tcp]
"""
import os
import sys
import socket
import threading
import subprocess

TCP_HOST = "127.0.0.1"
TCP_PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 35000
# Canal RFCOMM (1 por defecto). Si sale "Address already in use", prueba: OBD_BT_RFCOMM_CHANNEL=2 npm start
RFCOMM_CHANNEL = int(os.environ.get("OBD_BT_RFCOMM_CHANNEL", "1"))

def log(msg):
    print(msg, flush=True)

def get_adapter_address(hci):
    """Devuelve la MAC del adaptador (ej. hci1 -> E0:AD:47:20:31:E3)."""
    try:
        out = subprocess.run(
            ["hciconfig", hci],
            capture_output=True,
            text=True,
            timeout=2,
        )
        for line in (out.stdout or "").splitlines():
            if "BD Address:" in line or "Address:" in line:
                parts = line.split()
                for i, p in enumerate(parts):
                    if "Address" in p and i + 1 < len(parts):
                        return parts[i + 1].strip()
                    if len(p) == 17 and ":" in p and all(len(x) == 2 for x in p.split(":")):
                        return p
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass
    return None

def register_spp_sdptool(hci=None):
    try:
        cmd = ["sdptool", "add", "--channel=%d" % RFCOMM_CHANNEL, "SP"]
        if hci:
            cmd = ["sdptool", "-i", hci, "add", "--channel=%d" % RFCOMM_CHANNEL, "SP"]
        subprocess.run(cmd, capture_output=True, timeout=5, check=False)
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

def bridge(client_sock, tcp_sock):
    done = threading.Event()
    def forward(a, b):
        try:
            while not done.is_set():
                data = a.recv(4096)
                if not data:
                    break
                b.sendall(data)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            done.set()
    t1 = threading.Thread(target=forward, args=(client_sock, tcp_sock), daemon=True)
    t2 = threading.Thread(target=forward, args=(tcp_sock, client_sock), daemon=True)
    t1.start()
    t2.start()
    t1.join(timeout=60)
    t2.join(timeout=1)
    try:
        client_sock.close()
        tcp_sock.close()
    except OSError:
        pass

def main():
    try:
        import bluetooth
    except ImportError:
        log("Error: PyBluez no instalado. En la Pi: sudo apt install python3-bluez")
        sys.exit(1)

    hci = os.environ.get("OBD_BT_HCI", "").strip() or None
    bind_addr = ""
    if hci and hci.startswith("hci"):
        addr = get_adapter_address(hci)
        if addr:
            bind_addr = addr
            log("OBD2 BT bridge: usando adaptador %s (MAC %s) — conecta a esta MAC para SPP" % (hci, addr))
            register_spp_sdptool(hci)
        else:
            log("Aviso: no se obtuvo MAC para %s, usando adaptador por defecto" % hci)
    else:
        register_spp_sdptool()
        log("OBD2 BT bridge: usando adaptador por defecto (hci0). Para el dongle: OBD_BT_HCI=hci1")

    server_sock = bluetooth.BluetoothSocket(bluetooth.RFCOMM)
    try:
        server_sock.bind((bind_addr, RFCOMM_CHANNEL))
        server_sock.listen(1)
        try:
            bluetooth.advertise_service(
                server_sock, "OBD2",
                service_classes=[bluetooth.SERIAL_PORT_CLASS],
                profiles=[bluetooth.SERIAL_PORT_PROFILE],
            )
        except Exception as e:
            log("Aviso: advertise_service fallo (puede funcionar igual): " + str(e))
        log("OBD2 BT bridge: RFCOMM canal %d -> %s:%d. Esperando conexion..." % (RFCOMM_CHANNEL, TCP_HOST, TCP_PORT))
        while True:
            client_sock, client_addr = server_sock.accept()
            log("BT conectado: %s" % (client_addr,))
            try:
                tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                tcp_sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
                tcp_sock.settimeout(10)
                tcp_sock.connect((TCP_HOST, TCP_PORT))
                tcp_sock.settimeout(None)
                bridge(client_sock, tcp_sock)
            except (ConnectionRefusedError, OSError) as e:
                log("Error TCP a %s:%d: %s" % (TCP_HOST, TCP_PORT, e))
                try:
                    client_sock.close()
                except OSError:
                    pass
            log("BT desconectado.")
    except bluetooth.BluetoothError as e:
        log("Error Bluetooth: %s" % e)
        sys.exit(1)
    finally:
        server_sock.close()

if __name__ == "__main__":
    main()
