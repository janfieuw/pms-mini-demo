// routes/analyses.js
const express = require('express');

const router = express.Router();

// =====================
// Helpers - access data
// =====================

function getDb(req) {
  if (req.app && req.app.locals && req.app.locals.db) {
    return req.app.locals.db;
  }
  if (req.app && req.app.locals && req.app.locals.store) {
    return req.app.locals.store;
  }
  return { messages: [], shifts: [] };
}

function getMessages(req) {
  const db = getDb(req);
  return Array.isArray(db.messages) ? db.messages : [];
}

// De oude getShiftSource blijft staan (voor overview-oee en production)
function getShiftSource(req) {
  const appLocals = (req.app && req.app.locals) ? req.app.locals : {};
  const db = appLocals.db || {};
  const candidates = [];

  function pushIfArray(arr) {
    if (Array.isArray(arr) && arr.length) candidates.push(arr);
  }

  pushIfArray(db.shifts);
  pushIfArray(db.shiftPosts);
  pushIfArray(db.oeePosts);
  pushIfArray(appLocals.shifts);
  pushIfArray(appLocals.shiftPosts);
  pushIfArray(appLocals.oeePosts);

  if (!candidates.length) return [];
  return candidates.reduce((best, cur) => (cur.length > best.length ? cur : best), candidates[0]);
}

function parseMaybeDate(v) {
  if (v === undefined || v === null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

function getShiftOee(s) {
  if (!s) return null;
  const raw = s.oee ?? s.OEE ?? s.oeePercent ?? s.oee_percentage;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function getShiftProduced(s) {
  if (!s) return null;
  const raw = s.produced ?? s.Produced ?? s.production ?? s.prodKg;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function getShiftDowntime(s) {
  if (!s) return null;
  const raw = s.downtime ?? s.downtimeMin ?? s.downtimeMinutes ?? s.downtime_total;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// =====================
// RAW FILTER helpers
// =====================

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

function getFilteredReceiptsFromRaw(rawReceipts, field) {
  if (!field || !Array.isArray(rawReceipts)) return [];

  const withLabo = rawReceipts.filter(rec =>
    rec.labo &&
    rec.labo[field] !== null &&
    rec.labo[field] !== undefined &&
    rec.labo[field] !== ''
  );

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
    return aStr < bStr ? -1 : aStr > bStr ? 1 : 0;
  });
}

// =====================
// Middleware
// =====================

router.use((req, res, next) => {
  res.locals.activeSecondary = 'ANALYSES';
  next();
});

// =====================
// LANDINGSPAGINA → messages-filter
// =====================

router.get('/', (req, res) => res.redirect('/analyses/messages-filter'));

// =====================
// OVERVIEW OEE
// =====================

router.get('/overview-oee', (req, res) => {
  res.locals.activeTertiary = 'overview-oee';

  const source = getShiftSource(req);

  const rows = source.slice().sort((a, b) => {
    const ta = parseMaybeDate(a.at);
    const tb = parseMaybeDate(b.at);
    return tb - ta;
  });

  const values = rows
    .map(r => getShiftOee(r))
    .filter(v => v !== null);

  const avgOee = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;

  res.render('pages/analyses/overview-oee', {
    title: 'ANALYSES / OVERVIEW OEE',
    rows,
    avgOee
  });
});

// =====================
// PRODUCTION
// =====================

router.get('/production', (req, res) => {
  res.locals.activeTertiary = 'production';

  const source = getShiftSource(req);

  const rows = source.slice().sort((a, b) => {
    const ta = parseMaybeDate(a.at);
    const tb = parseMaybeDate(b.at);
    return tb - ta;
  });

  const values = rows
    .map(r => getShiftProduced(r))
    .filter(v => v !== null);

  const avgProduced = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : 0;

  res.render('pages/analyses/production', {
    title: 'ANALYSES / PRODUCTION',
    rows,
    avgProduced
  });
});

// =====================
// RAW FILTER
// =====================

router.get('/filter', (req, res) => {
  res.locals.activeTertiary = 'raw-filter';

  const field = req.query.field || 'ph';
  const mode = req.query.mode || 'view';

  const rawReceipts = Array.isArray(req.app.locals.rawReceipts)
    ? req.app.locals.rawReceipts
    : [];

  const filtered = getFilteredReceiptsFromRaw(rawReceipts, field);

  if (mode === 'excel') {
    let csv = '\uFEFF';
    csv += `ID;Batch;Article;Origin;Received date;Received time;Status;${field.toUpperCase()}\n`;

    filtered.forEach(rec => {
      const labValue = recValue(rec, field);
      csv += [
        rec.id,
        rec.batch,
        rec.article,
        rec.origin,
        rec.received_date,
        rec.received_time,
        rec.status,
        labValue
      ].join(';') + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="raw-filter-${field}.csv"`
    );
    return res.send(csv);
  }

  res.render('pages/raw/raw-filter', {
    title: 'ANALYSES / RAW FILTER',
    currentUser: req.user || null,
    field,
    receipts: filtered
  });
});

// =====================
// MESSAGES-FILTER
// =====================

const INFO_LABELS = [
  'B0110','R0140','B0210',
  'D0320','D0330','B0340',
  'BP0410','B0415','C0430','B0440',
  'M0451','FB0500','VT2003','VT2004',
  'S0621','B0625','BR0670','B0630',
  'B0710','B0720','B0680',
  'GS0910',
  'COAG','B1070','B1110',
  'EVAP','MVR','B1320','P1321',
  'CIP'
];

router.get('/messages-filter', (req, res) => {
  res.locals.activeTertiary = 'messages-filter';

  const selected = typeof req.query.label === 'string' ? req.query.label : '';
  const messages = getMessages(req);

  const results = selected
    ? messages.filter(m =>
        Array.isArray(m.infoLabels) && m.infoLabels.includes(selected)
      )
    : [];

  res.render('pages/analyses/messages-filter', {
    title: 'ANALYSES / MESSAGES FILTER',
    infoLabels: INFO_LABELS,
    selected,
    from: '',
    to: '',
    results
  });
});

module.exports = router;
