'use strict';

const express = require('express');
const { getNetworkInfo } = require('../lib/network');

const router = express.Router();

router.get('/network', (req, res) => {
  res.json(getNetworkInfo());
});

module.exports = router;
