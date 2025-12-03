// routes/raw.js
const express = require('express');
const router = express.Router();

// ----------------------------------------------
// ⭐ Centrale WMS-data importeren
// ----------------------------------------------
const { RAW_MATERIALS, RAW_ORIGINS } = require('../data/wms-data');

// ----------------------------------------------
// In-memory database voor ontvangsten (tijdelijk)
// ----------------------------------------------
let rawReceipts = [];
let nextId = 1;

function sortReceipts(list) {
  return list.slice().sort((a, b) => {
    const aDT = new Date(`${a.received_date}T${a.received_time}`);
    const bDT = new Date(`${b.received_date}T${b.received_time}`);
    return bDT - aDT;
  });
}

// ----------------------------------------------
// ⭐ RAW zichtbaar maken voor andere routers (bv. /bb/batch)
// ----------------------------------------------
router.use((req, res, next) => {
  if (req.app && req.app.locals) {
    req.app.locals.rawReceipts = rawReceipts;
  }
  next();
});

// ----------------------------------------------
// Helper voor RAW-FILTER
// ----------------------------------------------

// Waarde omzetten naar numeriek, incl. komma
function toNumeric(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(',', '.');
  const num = Number(str);
  return Number.isNaN(num) ? null : num;
}

function recValue(rec, field) {
  if (!rec.labo) return '';
  const v = rec.labo[field];
  return v === null || v === undefined ? '' : v;
}

function getFilteredReceipts(field) {
  if (!field) return [];

  const withLabo = rawReceipts.filter(rec => {
    return (
      rec.labo &&
      rec.labo[field] !== null &&
      rec.labo[field] !== undefined &&
      rec.labo[field] !== ''
    );
  });

  return withLabo.sort((a, b) => {
    const aVal = recValue(a, field);
    const bVal = recValue(b, field);

    const aNum = toNumeric(aVal);
    const bNum = toNumeric(bVal);

    if (aNum !== null && bNum !== null) return aNum - bNum;
    if (aNum !== null && bNum === null) return -1;
    if (aNum === null && bNum !== null) return 1;

    const aStr = String(aVal).toUpperCase();
    const bStr = String(bVal).toUpperCase();
    if (aStr < bStr) return -1;
    if (aStr > bStr) return 1;
    return 0;
  });
}

// ----------------------------------------------
// GET /raw/inbound-raw  → pagina RAW – INBOUND
// ----------------------------------------------
router.get('/inbound-raw', (req, res) => {
  res.render('pages/raw/raw-inbound', {
    currentUser: req.user || null,
    RAW_MATERIALS,
    RAW_ORIGINS
  });
});

// Alias
router.get('/inbound', (req, res) => res.redirect('/raw/inbound-raw'));

// ----------------------------------------------
// POST /raw/inbound-raw → nieuwe ontvangst
// ----------------------------------------------
router.post('/inbound-raw', (req, res) => {
  const {
    article,
    origin,
    batch,
    quantity,
    received_date,
    received_time,
    startlevel,
    operator
  } = req.body;

  if (!article || !origin || !batch || !received_date || !received_time) {
    return res.status(400).send('Verplichte velden ontbreken.');
  }

  const entry = {
    id: nextId++,
    article,
    origin,
    batch,
    quantity: quantity ? Number(quantity) : null,
    received_date,
    received_time,
    startlevel: startlevel ? Number(startlevel) : null,
    operator,
    status: 'BASIC',
    labo: null
  };

  rawReceipts.push(entry);

  res.redirect('/raw/overview');
});

// ----------------------------------------------
// GET /raw/overview
// ----------------------------------------------
router.get('/overview', (req, res) => {
  res.render('pages/raw/raw-overview', {
    currentUser: req.user || null,
    receipts: sortReceipts(rawReceipts)
  });
});

// ----------------------------------------------
// STEP 2 – LABO DATA
// ----------------------------------------------
router.get('/labo/:id', (req, res) => {
  const id = Number(req.params.id);
  const rec = rawReceipts.find(r => r.id === id);
  if (!rec) return res.status(404).send('Niet gevonden');

  res.render('pages/raw/raw-labo', {
    currentUser: req.user || null,
    receipt: rec
  });
});

router.post('/labo/:id', (req, res) => {
  const id = Number(req.params.id);
  const rec = rawReceipts.find(r => r.id === id);
  if (!rec) return res.status(404).send('Niet gevonden');

  rec.labo = {
    added_sap: req.body.added_sap || null,
    smell: req.body.smell || null,
    meal_temperature: req.body.meal_temperature || null,
    duration: req.body.duration || null,
    pressure_bar: req.body.pressure_bar || null,
    added_af: req.body.added_af || null,
    ph: req.body.ph || null,
    ds: req.body.ds || null
  };

  rec.status = 'COMPLETED';

  res.redirect('/raw/overview');
});

// ----------------------------------------------
// Oud → redirect naar analyses/filter
// ----------------------------------------------
router.get('/filter', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  const target = '/analyses/filter' + (query ? `?${query}` : '');
  return res.redirect(target);
});

// ----------------------------------------------
// ⭐ DELETE RAW RECORD
// ----------------------------------------------
router.post('/delete/:id', (req, res) => {
  const id = Number(req.params.id);

  const index = rawReceipts.findIndex(r => r.id === id);
  if (index === -1) {
    return res.status(404).send('Record not found');
  }

  rawReceipts.splice(index, 1);

  res.redirect('/raw/overview');
});

module.exports = router;
