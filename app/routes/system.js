'use strict';

const express = require('express');
const { getNetworkInfo } = require('../lib/network');
const { listPorts } = require('../lib/serial');
const gpsState = require('../lib/gps-serial-state');

const router = express.Router();

let serialPortModule = null;
function setSerialPort(sp) {
  serialPortModule = sp;
}

router.get('/', async (req, res) => {
  const network = getNetworkInfo();
  const serialPorts = await listPorts(serialPortModule);
  const gpsSerial = gpsState.getStatus();
  res.json({ network, serialPorts, gpsSerial });
});

module.exports = router;
module.exports.setSerialPort = setSerialPort;
