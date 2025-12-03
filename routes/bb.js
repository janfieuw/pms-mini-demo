// routes/bb.js
const express   = require('express');
const router    = express.Router();
const chemicals = require('../data/chemicals-data');
const batchRecords = require('../data/batchrecords'); // centrale batch opslag

// ==========================================
// Label-vertalingen
// ==========================================

const LABEL_TEXT = {
  nl: {
    productTitle: 'GEDROOGD AARDAPPEL POEDER',
    batch: 'BATCH:',
    productionDate: 'PRODUCTIE DATUM:',
    feed1: "voedermiddel'",
    feed2: 'Product van de aardappelverwerkingsindustrie',
    moisture: 'Vocht',
    starch: 'Zetmeel',
    fibre: 'Ruwe celstof'
  },
  en: {
    productTitle: 'DRIED POTATO POWDER',
    batch: 'BATCH:',
    productionDate: 'PRODUCTION DATE:',
    feed1: 'feed material',
    feed2: 'Product of the potato processing industry',
    moisture: 'Moisture',
    starch: 'Starch',
    fibre: 'Crude fibre'
  },
  es: {
    productTitle: 'POLVO DE PATATA DESHIDRATADO',
    batch: 'LOTE:',
    productionDate: 'FECHA DE PRODUCCIÓN:',
    feed1: 'materia prima para piensos',
    feed2: 'Producto de la industria de transformación de la patata',
    moisture: 'Humedad',
    starch: 'Almidón',
    fibre: 'Fibra bruta'
  },
  fr: {
    productTitle: 'POUDRE DE POMME DE TERRE SÉCHÉE',
    batch: 'LOT :',
    productionDate: 'DATE DE PRODUCTION :',
    feed1: "matière première pour aliments",
    feed2: "Produit de l'industrie de transformation de la pomme de terre",
    moisture: 'Humidité',
    starch: 'Amidon',
    fibre: 'Cellulose brute'
  },
  da: {
    productTitle: 'TØRRET KARTOFFELPULVER',
    batch: 'PARTI:',
    productionDate: 'PRODUKTIONSDATO:',
    feed1: 'fodermiddel',
    feed2: 'Produkt fra kartoffelforarbejdningsindustrien',
    moisture: 'Fugt',
    starch: 'Stivelse',
    fibre: 'Rå fiber'
  },
  cs: {
    productTitle: 'SUŠENÝ BRAMBOROVÝ PRÁŠEK',
    batch: 'ŠARŽE:',
    productionDate: 'DATUM VÝROBY:',
    feed1: 'krmná surovina',
    feed2: 'Výrobek bramborářského průmyslu',
    moisture: 'Vlhkost',
    starch: 'Škrob',
    fibre: 'Hrubá vláknina'
  },
  it: {
    productTitle: 'POLVERE DI PATATA ESSICCATA',
    batch: 'LOTTO:',
    productionDate: 'DATA DI PRODUZIONE:',
    feed1: 'materia prima per mangimi',
    feed2: "Prodotto dell'industria di trasformazione della patata",
    moisture: 'Umidità',
    starch: 'Amido',
    fibre: 'Fibra grezza'
  }
};

// ==========================================
// Helperfuncties voor datums
// ==========================================

// Parse ISO-date (YYYY-MM-DD) naar Date
function parseIsoDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Date → ISO (YYYY-MM-DD)
function toIsoDate(d) {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

// Date → label "DD/MM/YYYY"
function toEuDateLabel(d) {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// RAW datum/tijd (kan 'YYYY-MM-DD' of 'DD/MM/YYYY' zijn) → ms
function parseRawDateTimeMs(dateStr, timeStr) {
  if (!dateStr) return 0;
  const time = timeStr || '00:00';

  // 1) eerst proberen als ISO 'YYYY-MM-DD'
  let ms = Date.parse(`${dateStr}T${time}:00`);
  if (!Number.isNaN(ms)) return ms;

  // 2) fallback: 'DD/MM/YYYY'
  const m = String(dateStr).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return 0;
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);

  const t = String(time).match(/^(\d{1,2}):(\d{2})$/);
  const HH = t ? Number(t[1]) : 0;
  const MM = t ? Number(t[2]) : 0;

  const d = new Date(yyyy, mm - 1, dd, HH, MM, 0, 0);
  ms = d.getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

// Bouw range [startMs, endMs] op basis van twee ISO-datums (inclusief)
function buildDateRangeMs(startDate, endDate) {
  const start = parseIsoDate(startDate);
  const end   = parseIsoDate(endDate);

  if (!start || !end) return { fromMs: null, toMs: null };

  const fromMs = Date.UTC(
    start.getFullYear(),
    start.getMonth(),
    start.getDate(),
    0, 0, 0
  );
  const toMs = Date.UTC(
    end.getFullYear(),
    end.getMonth(),
    end.getDate(),
    23, 59, 59
  );

  return { fromMs, toMs };
}

// =============================
// SHIFTS helpers (gelijk aan analyses.js)
// =============================

// Data-bron voor shifts zoeken (db / app.locals)
function getShiftSource(req) {
  const appLocals = (req.app && req.app.locals) ? req.app.locals : {};
  const db = appLocals.db || {};
  const candidates = [];

  function pushIfArray(arr) {
    if (Array.isArray(arr) && arr.length) {
      candidates.push(arr);
    }
  }

  // mogelijke plaatsen voor shifts
  pushIfArray(db.shifts);
  pushIfArray(db.shiftPosts);
  pushIfArray(db.oeePosts);
  pushIfArray(appLocals.shifts);
  pushIfArray(appLocals.shiftPosts);
  pushIfArray(appLocals.oeePosts);

  if (!candidates.length) return [];

  return candidates.reduce(
    (best, cur) => (cur.length > best.length ? cur : best),
    candidates[0]
  );
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

// Labels zoals "START: 15/11/2025 - 05:00"
function parseLabelToMs(label) {
  if (!label || typeof label !== 'string') return 0;
  const m = label.match(/:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, min] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
  const d = new Date(iso);
  const ms = d.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function getShiftStartMs(s) {
  if (!s) return 0;
  return (
    parseMaybeDate(s.startAt) ||
    parseMaybeDate(s.start) ||
    parseMaybeDate(s.shiftStart) ||
    parseMaybeDate(s.from) ||
    parseMaybeDate(s.begin) ||
    parseLabelToMs(s.startLabel) ||
    parseMaybeDate(s.startLabelAt) ||
    0
  );
}

function getShiftEndMs(s) {
  if (!s) return 0;
  return (
    parseMaybeDate(s.endAt) ||
    parseMaybeDate(s.end) ||
    parseMaybeDate(s.stopAt) ||
    parseMaybeDate(s.shiftEnd) ||
    parseMaybeDate(s.to) ||
    parseMaybeDate(s.finish) ||
    parseLabelToMs(s.endLabel) ||
    parseMaybeDate(s.endLabelAt) ||
    0
  );
}

function getShiftProduced(s) {
  if (!s) return null;
  const raw = s.produced ?? s.Produced ?? s.production ?? s.prodKg;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

// =============================
// 1) PRODUCED uit shifts (ANALYSES / PRODUCTION)
// =============================

function formatShiftLabelFromMs(ms) {
  if (!ms) return '';
  const d  = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  // zelfde stijl als je andere labels: "dd/mm/yyyy - HH:MM"
  return `${dd}/${mm}/${yyyy} - ${HH}:${MM}`;
}

async function getProducedInPeriod(req, startDate, endDate) {
  const source = getShiftSource(req);
  if (!Array.isArray(source) || !source.length) return [];

  const { fromMs, toMs } = buildDateRangeMs(startDate, endDate);
  if (!fromMs || !toMs) return [];

  const mapped = source.map(s => ({
    raw: s,
    startMs: getShiftStartMs(s),
    endMs: getShiftEndMs(s),
    produced: getShiftProduced(s)
  }));

  const filtered = mapped
    .filter(r =>
      r.startMs &&
      r.endMs &&
      r.produced !== null &&
      r.endMs >= fromMs &&
      r.startMs <= toMs
    )
    .sort((a, b) => a.startMs - b.startMs);

  return filtered.map(r => {
    const startLabel =
      (r.raw && r.raw.startLabel) || formatShiftLabelFromMs(r.startMs);
    const endLabel =
      (r.raw && r.raw.endLabel) || formatShiftLabelFromMs(r.endMs);

    return {
      // geen aparte date meer
      start: startLabel,
      end: endLabel,
      qtyKg: r.produced
    };
  });
}

// =============================
// 2) RAW uit RAW • OVERVIEW (req.app.locals.rawReceipts)
// =============================

async function getRawInPeriod(req, startDate, endDate) {
  const rawReceipts = Array.isArray(req.app.locals.rawReceipts)
    ? req.app.locals.rawReceipts
    : [];

  const { fromMs, toMs } = buildDateRangeMs(startDate, endDate);
  if (!fromMs || !toMs || !rawReceipts.length) return [];

  const mapped = rawReceipts.map(rec => {
    const dateStr = rec.received_date || '';
    const timeStr = rec.received_time || '00:00';
    const ms = parseRawDateTimeMs(dateStr, timeStr);
    return { rec, ms };
  });

  const filtered = mapped
    .filter(r => r.ms && r.ms >= fromMs && r.ms <= toMs)
    .sort((a, b) => a.ms - b.ms);

  return filtered.map(({ rec }) => ({
    date: rec.received_date || '',
    batch: rec.batch || '',
    article: rec.article || '',
    origin: rec.origin || '',
    qtyKg: rec.quantity != null ? (Number(rec.quantity) || 0) : 0
  }));
}

// =============================
// 3) USED CHEMICALS uit chemicals.getUsageOverview()
// =============================

async function getChemicalsInPeriod(req, startDate, endDate) {
  const allUsed = typeof chemicals.getUsageOverview === 'function'
    ? (chemicals.getUsageOverview() || [])
    : [];

  const { fromMs, toMs } = buildDateRangeMs(startDate, endDate);
  if (!fromMs || !toMs || !allUsed.length) return [];

  const mapped = allUsed.map(u => {
    const startMs = u.startDate ? Date.parse(u.startDate) : null;
    const endMs   = u.endDate ? Date.parse(u.endDate) : null;
    return { raw: u, startMs, endMs };
  });

  const filtered = mapped
    .filter(r => {
      if (!r.startMs) return false;
      const start = r.startMs;
      const end   = r.endMs || r.startMs;
      return end >= fromMs && start <= toMs;
    })
    .sort((a, b) => a.startMs - b.startMs);

  return filtered.map(r => {
    const d    = r.startMs ? new Date(r.startMs) : null;
    const date = d ? toIsoDate(d) : '';
    const u    = r.raw || {};

    return {
      date,
      product: u.articleName || u.articleId || '',
      lot: u.lotNumber || '',
      // verbruik is niet belangrijk → qtyKg niet gebruikt
      qtyKg: null
    };
  });
}

// =============================
// 4) Batch summary (voor de preview in batch-creation)
// =============================

function buildBatchSummary(startDate, endDate, produced, raws, chemicals) {
  const sum = arr => arr.reduce((acc, x) => acc + (Number(x.qtyKg) || 0), 0);

  const totalProducedKg  = sum(produced);
  const totalRawKg       = sum(raws);
  // Chemicals niet meetellen in de totalen
  const totalChemicalsKg = 0;

  // Batchcode: AP-YYMMDD01 op basis van vandaag
  const now  = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const yy   = String(now.getFullYear()).slice(-2);
  const mm   = pad2(now.getMonth() + 1);
  const dd   = pad2(now.getDate());
  const batchCode = `AP-${yy}${mm}${dd}01`;

  // Expiry = huidig jaar + 1 / weeknummer creatie
  const isoWeek = d => {
    const date   = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  };
  const expYear  = now.getFullYear() + 1;
  const expWeek  = pad2(isoWeek(now));
  const expiryCode = `${expYear}/${expWeek}`;

  return {
    totalProducedKg,
    totalRawKg,
    totalChemicalsKg,
    batchCode,
    expiryCode
  };
}

// ==========================================
// Batches via datafile batchrecords.js
// ==========================================

// Batch-basisinfo uit form body halen (maar nog NIET bewaren)
function createBatchFromBody(body) {
  const startDate = body.startDate || body.fromDate || '';
  const endDate   = body.endDate   || body.toDate   || '';

  const batchCode  = body.batchCode  || body.batch_code  || '';
  const expiryCode = body.expiryCode || body.expiry_code || '';

  return {
    startDate,
    endDate,
    batchCode,
    expiryCode
  };
}

// Lots afleiden uit batches (nieuwste eerst) voor BB DISCHARGE
function getLotsFromBatches() {
  const allBatches = batchRecords.getAllBatchRecords() || [];

  return allBatches
    .filter(b => b.batchCode)
    .map(b => ({
      code: b.batchCode,
      expiryCode: b.expiryCode,
      createdAt: b.createdAt
    }))
    .sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt) : 0;
      const db = b.createdAt ? new Date(b.createdAt) : 0;
      return db - da;
    });
}

// Formatter: zelfde notatie als in batch-overview (DD/MM/YYYY - HH:MM)
function formatDateTimeNoSeconds(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} - ${HH}:${MM}`;
}

// Verrijk slots met batch-info op basis van lot/batchCode
function attachBatchInfoToSlots(slots) {
  const allBatches = batchRecords.getAllBatchRecords() || [];
  const byCode = new Map();
  allBatches.forEach(b => {
    if (b && b.batchCode) {
      byCode.set(String(b.batchCode), b);
    }
  });

  return slots.map(s => {
    const lot = s.lot ? String(s.lot) : '';
    const batch = lot ? byCode.get(lot) : null;

    const createdAt = batch && batch.createdAt ? new Date(batch.createdAt) : null;
    let createdAtMs = 0;
    let createdLabel = '';

    if (createdAt && !Number.isNaN(createdAt.getTime())) {
      createdAtMs = createdAt.getTime();
      createdLabel = formatDateTimeNoSeconds(createdAt);
    }

    return {
      ...s,
      createdAtMs,
      createdLabel
    };
  });
}

// ==========================================
// In-memory opslag voor BB discharges
// ==========================================

let discharges = [];
let nextDischargeId = 1;

// 🔸 NIEUW: discharges beschikbaar maken voor andere domeinen (bv. SHIFTS)
router.use((req, res, next) => {
  if (req.app && req.app.locals) {
    req.app.locals.bbDischarges = discharges;
  }
  next();
});

// Helper: operatorcode ophalen uit session / login
function getOperatorCode(req) {
  const sess = req.session || {};
  if (sess.user) {
    if (sess.user.code) return sess.user.code;
    if (sess.user.initials) return sess.user.initials;
    if (sess.user.name) return sess.user.name;
  }
  if (sess.operatorCode) return sess.operatorCode;
  if (sess.username) return sess.username;
  return '';
}

// Nieuwe versie: ondersteunt ZOWEL oude als nieuwe form velden
function createDischargeFromBody(body) {
  const now = new Date();

  // Oude velden
  const oldDischargeDate = body.dischargeDate || '';
  const oldDischargeTime = body.dischargeTime || '';
  const oldOperator      = body.operator || '';
  const oldBbLot         = body.bbLot || '';
  const oldDestination   = body.destination || '';
  const oldRemarks       = body.remarks || '';

  // Nieuwe velden volgens BB-DISCHARGE layout:
  const originSilo   = body.originSilo || '';
  const lotNumber    = body.lotNumber || oldBbLot || '';
  const locationCode = body.locationCode || oldDestination || '';
  const quantityKg   = Number(body.quantityKg || 0) || 0;

  const todayIso = new Date().toISOString().slice(0, 10);

  return {
    id: nextDischargeId++,
    dischargeDate: oldDischargeDate || todayIso,
    dischargeTime: oldDischargeTime || '',
    operator: oldOperator || '',
    remarks: oldRemarks || '',

    originSilo,
    lotNumber,
    locationCode,
    quantityKg,
    status: 'occupied',

    bbLot: lotNumber,
    destination: locationCode,

    customer: '',
    shippingDate: '',
    reference: '',
    allocationRemarks: '',

    createdAt: now
  };
}

// 312 slots bouwen op basis van discharges
function buildSlotsFromDischarges(allDischarges) {
  const cols = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const slots = [];

  for (let row = 1; row <= 26; row++) {
    for (const col of cols) {
      const code = `${row}${col}`;
      slots.push({
        code,
        row,
        col,
        status: 'free',
        lot: '',
        quantityKg: 0
      });
    }
  }

  // nieuwste bewegingen moeten de oude overschrijven → reverse
  const ordered = Array.isArray(allDischarges)
    ? [...allDischarges].reverse()
    : [];

  ordered.forEach(d => {
    if (!d.locationCode) return;
    const code = String(d.locationCode).toUpperCase().trim();
    const slot = slots.find(s => s.code.toUpperCase() === code);
    if (!slot) return;

    slot.status = d.status || 'occupied';
    slot.lot = d.lotNumber || d.bbLot || '';
    slot.quantityKg = d.quantityKg || 0;
  });

  return slots;
}

// Beschikbare slots voor allocatie (alle "occupied" vakken)
// + batch-created info (createdLabel) eraan hangen en sorteren oud → nieuw
function getAvailableSlotsForAllocation() {
  const slots = buildSlotsFromDischarges(discharges);
  const occupied = slots.filter(s => s.status === 'occupied');
  const enriched = attachBatchInfoToSlots(occupied);

  enriched.sort((a, b) => {
    const am = a.createdAtMs || 0;
    const bm = b.createdAtMs || 0;
    return am - bm;
  });

  return enriched;
}

// Allocations ophalen uit discharges (status 'allocated')
function getAllocations(filter = {}) {
  const { customer, shippingDate } = filter;

  let list = discharges.filter(d => d.status === 'allocated');

  if (customer) {
    list = list.filter(d => d.customer === customer);
  }
  if (shippingDate) {
    list = list.filter(d => d.shippingDate === shippingDate);
  }

  list.sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt) : 0;
    const db = b.createdAt ? new Date(b.createdAt) : 0;
    return db - da;
  });

  return list;
}

// STOCK samenvatting per batch (free vs allocated)
function buildStockSummaryFromDischarges() {
  const stockSummaryMap = new Map();
  const allBatches = batchRecords.getAllBatchRecords() || [];

  discharges.forEach(d => {
    if (!d.lotNumber) return;

    const batchCode = d.lotNumber;
    const batch = allBatches.find(b => b.batchCode === batchCode) || null;

    if (!stockSummaryMap.has(batchCode)) {
      stockSummaryMap.set(batchCode, {
        batchCode,
        startDate: batch ? batch.startDate : '',
        free1000: 0,
        free1100: 0,
        free1200: 0,
        alloc1000: 0,
        alloc1100: 0,
        alloc1200: 0
      });
    }

    const entry = stockSummaryMap.get(batchCode);
    const qty = d.quantityKg;
    const isAllocated = d.status === 'allocated';

    const inc = field => {
      entry[field] = (entry[field] || 0) + 1;
    };

    if (qty === 1000) {
      isAllocated ? inc('alloc1000') : inc('free1000');
    } else if (qty === 1100) {
      isAllocated ? inc('alloc1100') : inc('free1100');
    } else if (qty === 1200) {
      isAllocated ? inc('alloc1200') : inc('free1200');
    }
  });

  const summary = Array.from(stockSummaryMap.values());
  summary.sort((a, b) => {
    if (a.startDate && b.startDate && a.startDate !== b.startDate) {
      return a.startDate.localeCompare(b.startDate);
    }
    return (a.batchCode || '').localeCompare(b.batchCode || '');
  });

  return summary;
}

/**
 * ROUTES BB WAREHOUSING + BATCH
 */

// BATCH - CREATION (GET)
router.get('/batch', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.render('pages/bb/batch-creation', {
      activeDomain: 'BATCH',
      activePage: 'BATCH - CREATION',
      startDate: '',
      endDate: '',
      produced: [],
      raws: [],
      chemicals: [],
      summary: null
    });
  }

  const produced  = await getProducedInPeriod(req, startDate, endDate);
  const raws      = await getRawInPeriod(req, startDate, endDate);
  const chems     = await getChemicalsInPeriod(req, startDate, endDate);
  const summary   = buildBatchSummary(startDate, endDate, produced, raws, chems);

  res.render('pages/bb/batch-creation', {
    activeDomain: 'BATCH',
    activePage: 'BATCH - CREATION',
    startDate,
    endDate,
    produced,
    raws,
    chemicals: chems,
    summary
  });
});

// BATCH - CREATION (POST)  → enkel nieuwe periode kiezen / herberekenen
router.post('/batch', async (req, res) => {
  const { startDate, endDate } = req.body;

  if (!startDate || !endDate) {
    return res.render('pages/bb/batch-creation', {
      activeDomain: 'BATCH',
      activePage: 'BATCH - CREATION',
      startDate: startDate || '',
      endDate: endDate || '',
      produced: [],
      raws: [],
      chemicals: [],
      summary: null,
      error: 'Gelieve zowel start- als einddatum te kiezen.'
    });
  }

  const produced  = await getProducedInPeriod(req, startDate, endDate);
  const raws      = await getRawInPeriod(req, startDate, endDate);
  const chems     = await getChemicalsInPeriod(req, startDate, endDate);
  const summary   = buildBatchSummary(startDate, endDate, produced, raws, chems);

  res.render('pages/bb/batch-creation', {
    activeDomain: 'BATCH',
    activePage: 'BATCH - CREATION',
    startDate,
    endDate,
    produced,
    raws,
    chemicals: chems,
    summary
  });
});

// BATCH definitief bewaren – met samenstelling
router.post('/batch/save', async (req, res) => {
  const base = createBatchFromBody(req.body);
  const { startDate, endDate, batchCode, expiryCode } = base;

  let producedLots = [];
  let rawLots = [];
  let chemicalLots = [];

  if (startDate && endDate) {
    const produced = await getProducedInPeriod(req, startDate, endDate);
    const raws     = await getRawInPeriod(req, startDate, endDate);
    const chems    = await getChemicalsInPeriod(req, startDate, endDate);

    // Produced lots: gebruik start → eind label als "lot"
    producedLots = produced.map(p => ({
      lot: `${p.start} → ${p.end}`,
      kg: Number(p.qtyKg) || 0
    }));

    // Raw lots: batch of artikel + origin meestoren
    rawLots = raws.map(r => ({
      lot: r.batch || r.article || '',
      origin: r.origin || '',
      kg: Number(r.qtyKg) || 0
    }));

    // Chemicals lots: lotnummer + artikelnaam meestoren
    chemicalLots = chems.map(c => ({
      lot: c.lot || c.product || '',
      article: c.product || '',
      kg: c.qtyKg != null ? (Number(c.qtyKg) || 0) : 0
    }));
  }

  batchRecords.createBatchRecord({
    batchCode,
    expiryCode,
    startDate,
    endDate,
    producedLots,
    rawLots,
    chemicalLots
  });

  return res.redirect('/bb/batch-overview');
});

// BATCH - OVERVIEW
router.get('/batch-overview', (req, res) => {
  const batches = batchRecords.getAllBatchRecords() || [];

  res.render('pages/bb/batch-overview', {
    activeDomain: 'BATCH',
    activePage: 'BATCH - OVERVIEW',
    batches
  });
});

// BATCH - DETAIL (klik op batchnummer)
router.get('/batch/:id', (req, res) => {
  const batch = batchRecords.getBatchRecord(req.params.id);

  if (!batch) {
    return res.status(404).send('Batch not found');
  }

  res.render('pages/bb/batch-detail', {
    activeDomain: 'BATCH',
    activePage: 'BATCH - DETAIL',
    batch
  });
});

// BB - DISCHARGE
router.get('/discharge', (req, res) => {
  const lots  = getLotsFromBatches();
  const slots = buildSlotsFromDischarges(discharges);

  res.render('pages/bb/bb-discharge', {
    activeDomain: 'BB WAREHOUSING',
    activePage: 'BB - DISCHARGE',
    discharges,
    lots,
    slots
  });
});

// BB - DISCHARGE OVERVIEW
router.get('/discharge-overview', (req, res) => {
  const list = discharges || [];

  res.render('pages/bb/bb-discharge-overview', {
    activeDomain: 'BB WAREHOUSING',
    activePage: 'BB - DISCHARGE OVERVIEW',
    discharges: list
  });
});

router.post('/discharge/save', (req, res) => {
  // body verrijken met operator uit session
  const bodyWithOperator = {
    ...req.body,
    operator: getOperatorCode(req)
  };
  const discharge = createDischargeFromBody(bodyWithOperator);
  discharges.unshift(discharge);
  return res.redirect('/bb/discharge');
});

// BB - DISCHARGE LABEL PRINT
router.post('/discharge/print-label', (req, res) => {
  // 1) discharge ook registreren zodat het vakje wordt toegekend
  const bodyWithOperator = {
    ...req.body,
    operator: getOperatorCode(req)
  };
  const discharge = createDischargeFromBody(bodyWithOperator);
  discharges.unshift(discharge);

  // 2) data voor het label
  const locationCode = discharge.locationCode;
  const quantityKg   = discharge.quantityKg;
  const originSilo   = discharge.originSilo;
  const lotNumber    = discharge.lotNumber;

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, '0');
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const yyyy = today.getFullYear();
  const productionDate = `${dd}/${mm}/${yyyy}`;

  const operatorCode = getOperatorCode(req);
  const lang = req.body.labelLang || 'nl';
  const L = LABEL_TEXT[lang] || LABEL_TEXT.nl;

  // logo-bestand (fallback naar RS-logo)
  const logoFile = req.body.logoChoice || 'rs-logo.png';

  // 3) label renderen (in nieuw venster via target="_blank" in het formulier)
  res.render('pages/bb/bb-discharge-label', {
    layout: false,
    locationCode,
    quantityKg,
    originSilo,
    lotNumber,
    productionDate,
    operatorCode,
    L,
    lang,
    logoFile
  });
});


// BB - ALLOCATION
router.get('/allocation', (req, res) => {
  const { customer = '', shippingDate = '', reference = '', remarks = '' } = req.query;

  const availableSlots = getAvailableSlotsForAllocation();
  const allocations    = getAllocations({ customer, shippingDate });

  res.render('pages/bb/bb-allocation', {
    activeDomain: 'BB WAREHOUSING',
    activePage: 'BB - ALLOCATION',
    availableSlots,
    allocations,
    customer,
    shippingDate,
    reference,
    remarks
   });
});

router.post('/allocation/allocate', (req, res) => {
  const customer     = req.body.customer || '';
  const shippingDate = req.body.shippingDate || '';
  const reference    = req.body.reference || '';
  const remarks      = req.body.remarks || '';

  let locations = req.body.locations || req.body['locations[]'] || [];
  if (!Array.isArray(locations)) locations = [locations];

  locations.forEach(loc => {
    if (!loc) return;
    const code = String(loc).toUpperCase().trim();

    const candidates = discharges
      .filter(d => String(d.locationCode).toUpperCase().trim() === code);

    if (!candidates.length) return;

    candidates.sort((a, b) => {
      const da = a.createdAt ? new Date(a.createdAt) : 0;
      const db = b.createdAt ? new Date(b.createdAt) : 0;
      return db - da;
    });

    const latest = candidates[0];
    latest.status            = 'allocated';
    latest.customer          = customer;
    latest.shippingDate      = shippingDate;
    latest.reference         = reference;
    latest.allocationRemarks = remarks;
  });

  const query = new URLSearchParams({
    customer,
    shippingDate,
    reference,
    remarks
  }).toString();

  return res.redirect(`/bb/allocation?${query}`);
});

// BB - LOADING
router.get('/loading', (req, res) => {
  const { shippingDate = '', customer = '', reference = '' } = req.query;

  let loadingList = discharges.filter(d => d.status === 'allocated');

  if (shippingDate) {
    loadingList = loadingList.filter(d => d.shippingDate === shippingDate);
  }
  if (customer) {
    loadingList = loadingList.filter(d => d.customer === customer);
  }

  loadingList.sort((a, b) => {
    const aCode = String(a.locationCode || '').toUpperCase();
    const bCode = String(b.locationCode || '').toUpperCase();
    return aCode.localeCompare(bCode);
  });

  res.render('pages/bb/bb-loading', {
    activeDomain: 'BB WAREHOUSING',
    activePage: 'BB - LOADING',
    shippingDate,
    customer,
    reference,
    loadingList
  });
});

// BB - STOCK
router.get('/stock', (req, res) => {
  const stockSummary = buildStockSummaryFromDischarges();

  res.render('pages/bb/bb-stock', {
    activeDomain: 'BB WAREHOUSING',
    activePage: 'BB - STOCK',
    stockSummary
  });
});

// DEBUG: toon alle BB discharges als JSON
router.get('/debug-discharges', (req, res) => {
  res.json(req.app.locals.bbDischarges || []);
});


module.exports = router;
