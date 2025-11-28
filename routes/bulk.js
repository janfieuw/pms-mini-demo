// routes/bulk.js
//
// Domein: BULK
// Pagina's:
// - GET  /bulk/registratie
// - POST /bulk/registratie
// - GET  /bulk/all

const express = require('express');
const router = express.Router();

// ============================================================================
//  K L A N T E N L I J S T   (INLINE, VOLGENS JOUW LIJST)
// ============================================================================
const BB_CUSTOMERS = [
  "UNITED PETFOODS (NL-Coevorden)",
  "UNITED PETFOODS (NL-Waalwijk)",
  "NUTRIFRED",
  "PLANTUFE LOOP",
  "UNITED PETFOODS (DK)",
  "UNITED PETFOODS (BE-Wimille)",
  "UNITED PETFOODS (BE-Gent)",
  "GA PETFOOD",
  "AFFINITY (IT)",
  "AFFINITY (FR)",
  "AFFINITY (SP)",
  "SAVALUE PRODUCTION (FR)",
  "PARTNER IN PET FOOD (CZ)",
  "PARTNER IN PET FOOD (Nordics AB)",
  "FIDES (BE-Oostende)"
];

// ============================================================================
//  HELPERS
// ============================================================================
function nowDDMMYYYY() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mn = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mn}`;
}

function getBulkStore(req) {
  // gebruik dezelfde globale store als de rest van de app
  const store = req.app.locals.store || (req.app.locals.store = {});
  if (!store.bulkDeliveries) store.bulkDeliveries = [];
  return store.bulkDeliveries;
}

// ============================================================================
//  GET /bulk/registratie
// ============================================================================
router.get('/registratie', (req, res) => {
  res.render('pages/bulk/bulk-registratie', {
    title: 'BULK • REGISTRATIE',
    BB_CUSTOMERS,
    error: null,
    old: {
      customer: '',
      silo: '',
      kg: '',
      cmr: '',
      purchase_order: '',
      delivery_note: '',
      remark: '',
      date: nowDDMMYYYY(),
      time: nowHHMM()
    }
  });
});

// ============================================================================
//  POST /bulk/registratie
// ============================================================================
router.post('/registratie', (req, res) => {
  const {
    customer,
    silo,
    kg,
    cmr,
    purchase_order,
    delivery_note,
    remark,
    date,
    time
  } = req.body;

  const errors = [];

  if (!customer) errors.push("Customer is verplicht.");
  if (!silo || (silo !== '710' && silo !== '720')) errors.push("Silo moet 710 of 720 zijn.");
  if (!kg || isNaN(Number(kg)) || Number(kg) <= 0) errors.push("Weight (kg) moet een positief getal zijn.");
  if (!date) errors.push("Date is verplicht.");
  if (!time) errors.push("Time is verplicht.");

  if (errors.length > 0) {
    return res.status(400).render('pages/bulk/bulk-registratie', {
      title: 'BULK • REGISTRATIE',
      BB_CUSTOMERS,
      error: errors.join(' '),
      old: {
        customer,
        silo,
        kg,
        cmr,
        purchase_order,
        delivery_note,
        remark,
        date,
        time
      }
    });
  }

  const bulkDeliveries = getBulkStore(req);

  const record = {
    id: Date.now().toString(),
    created_at: new Date().toISOString(),

    date_label: date,
    time_label: time,

    silo,
    kg: Number(kg),

    customer,

    cmr: cmr || '',
    purchase_order: purchase_order || '',
    delivery_note: delivery_note || '',
    remark: remark || ''
  };

  // opslaan in memory (zoals RAW / BB / CHEMICALS)
  bulkDeliveries.unshift(record);

  // Alles OK → redirect naar overzicht
  res.redirect('/bulk/all');
});

// ============================================================================
//  GET /bulk/all
// ============================================================================
router.get('/all', (req, res) => {
  const bulkDeliveries = getBulkStore(req);

  // kopie + sorteren op created_at desc
  const rows = [...bulkDeliveries].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || '')
  );

  res.render('pages/bulk/bulk-all', {
    title: "BULK • ALL",
    deliveries: rows,
    error: null
  });
});

// ============================================================================
//  EXPORT
// ============================================================================
module.exports = router;
