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
// (helpers blijven hier staan – nu vooral nuttig als referentie)
// ----------------------------------------------

// Waarde omzetten naar numeriek als dat kan (met support voor komma-decimaal)
function toNumeric(value) {
  if (value === null || value === undefined) return null;
  const str = String(value).replace(',', '.'); // "5,8" → "5.8"
  const num = Number(str);
  return Number.isNaN(num) ? null : num;
}

function recValue(rec, field) {
  if (!rec.labo) return '';
  const v = rec.labo[field];
  return v === null || v === undefined ? '' : v;
}

/**
 * Geeft lijst van ontvangsten terug met labo-waarde voor gekozen veld,
 * gesorteerd van klein → groot (numeriek indien mogelijk, anders alfabetisch).
 *
 * field = 'ph', 'ds', 'meal_temperature', 'duration',
 *         'pressure_bar', 'added_sap', 'smell', 'added_af', ...
 */
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

    // Beide numeriek → numeriek sorteren
    if (aNum !== null && bNum !== null) {
      return aNum - bNum;
    }

    // Eén van de twee numeriek → numeriek eerst
    if (aNum !== null && bNum === null) return -1;
    if (aNum === null && bNum !== null) return 1;

    // Geen van beide numeriek → alfabetisch
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

// Alias /raw/inbound (gebruik in nav)
// ----------------------------------------------
router.get('/inbound', (req, res) => res.redirect('/raw/inbound-raw'));

// ----------------------------------------------
// POST /raw/inbound-raw → maakt BASIC ontvangst aan
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
    // nieuw veld voor overzicht:
    startlevel: startlevel ? Number(startlevel) : null,
    operator,
    status: 'BASIC',   // BASIC = labo-data ontbreekt
    labo: null         // wordt ingevuld na labo-analyse
  };

  rawReceipts.push(entry);

  res.redirect('/raw/overview');
});

// ----------------------------------------------
// GET /raw/overview → pagina RAW – OVERVIEW
// ----------------------------------------------
router.get('/overview', (req, res) => {
  res.render('pages/raw/raw-overview', {
    currentUser: req.user || null,
    receipts: sortReceipts(rawReceipts)
  });
});

// ----------------------------------------------
// STEP 2: LABO DATA
// ----------------------------------------------

// GET → toont laboformulier voor één ontvangst
router.get('/labo/:id', (req, res) => {
  const id = Number(req.params.id);
  const rec = rawReceipts.find(r => r.id === id);
  if (!rec) {
    return res.status(404).send('Niet gevonden');
  }

  res.render('pages/raw/raw-labo', {
    currentUser: req.user || null,
    receipt: rec
  });
});

// POST → bewaart labo-waarden, markeert COMPLETED en terug naar overview
router.post('/labo/:id', (req, res) => {
  const id = Number(req.params.id);
  const rec = rawReceipts.find(r => r.id === id);
  if (!rec) {
    return res.status(404).send('Niet gevonden');
  }

  // Velden 1–2: 4-keuze segmenten (zoals Excel)
  // Velden 3–8: vrije tekst/numerieke invulvelden
  rec.labo = {
    added_sap: req.body.added_sap || null,               // NONE / FRESH / B1070 / B1070+FRESH
    smell: req.body.smell || null,                       // A / B / C / D
    meal_temperature: req.body.meal_temperature || null, // MAALTEMPERATUUR
    duration: req.body.duration || null,                 // DUUR
    pressure_bar: req.body.pressure_bar || null,         // BAR
    added_af: req.body.added_af || null,                 // TOEGEVOEGD AF
    ph: req.body.ph || null,                             // pH
    ds: req.body.ds || null                              // DS%
  };

  rec.status = 'COMPLETED';

  res.redirect('/raw/overview');
});

// ----------------------------------------------
// STEP 3 (OUD): RAW – FILTER
// Deze route bestond als /raw/filter.
// Nu is de pagina verhuisd naar /analyses/filter.
// We houden hier een redirect voor oude bookmarks.
// ----------------------------------------------
router.get('/filter', (req, res) => {
  const query = new URLSearchParams(req.query).toString();
  const target = '/analyses/filter' + (query ? `?${query}` : '');
  return res.redirect(target);
});

module.exports = router;
