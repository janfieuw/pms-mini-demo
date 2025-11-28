// data/batchrecords.js
// Centrale in-memory opslag van batchrecords + samenstelling

// interne opslag
let records = [];
let nextId  = 1;

/**
 * Kleine helper om kg op te tellen in een lijst
 * list = [{ kg: 123 }, { kg: 5 }, ...]
 */
function sumKg(list) {
  if (!Array.isArray(list)) return 0;
  return list.reduce((total, item) => {
    const v = Number(item.kg);
    return total + (Number.isFinite(v) ? v : 0);
  }, 0);
}

/**
 * Maak / registreer een nieuw batchrecord.
 *
 * data kan volgende velden bevatten:
 *  - batchCode, expiryCode
 *  - startDate, endDate, periodLabel
 *  - producedLots:  [{ lot, kg }]
 *  - rawLots:       [{ lot, kg }]
 *  - chemicalLots:  [{ lot, kg }]
 *  - totalProducedKg, totalRawKg, totalChemicalsKg (optioneel, worden anders berekend)
 */
function createBatchRecord(data = {}) {
  const {
    batchCode      = '',
    expiryCode     = '',
    startDate      = '',
    endDate        = '',
    periodLabel    = '',
    producedLots   = [],
    rawLots        = [],
    chemicalLots   = [],
    totalProducedKg,
    totalRawKg,
    totalChemicalsKg
  } = data;

  // periode-label zelf opbouwen indien niet meegegeven
  const period =
    periodLabel ||
    (startDate && endDate ? `${startDate} → ${endDate}` : '');

  // totalen berekenen als ze niet expliciet zijn doorgegeven
  const tp = Number.isFinite(Number(totalProducedKg))
    ? Number(totalProducedKg)
    : sumKg(producedLots);

  const tr = Number.isFinite(Number(totalRawKg))
    ? Number(totalRawKg)
    : sumKg(rawLots);

  const tc = Number.isFinite(Number(totalChemicalsKg))
    ? Number(totalChemicalsKg)
    : sumKg(chemicalLots);

  const record = {
    id: nextId++,
    batchCode,
    expiryCode,
    startDate,
    endDate,
    periodLabel: period,
    createdAt: new Date(),

    // samenstelling
    producedLots: Array.isArray(producedLots) ? producedLots : [],
    rawLots: Array.isArray(rawLots) ? rawLots : [],
    chemicalLots: Array.isArray(chemicalLots) ? chemicalLots : [],

    // totalen
    totalProducedKg: tp,
    totalRawKg: tr,
    totalChemicalsKg: tc
  };

  records.push(record);
  return record;
}

/**
 * Soms wil je een volledig opgebouwd batch-object
 * (vb. uit createBatchFromBody in bb.js) gewoon opslaan.
 */
function addBatch(batch) {
  if (!batch || typeof batch !== 'object') return null;

  const copy = { ...batch };

  if (!Number.isFinite(Number(copy.id))) {
    copy.id = nextId++;
  } else {
    // zorg dat nextId altijd hoger ligt dan bestaande ids
    nextId = Math.max(nextId, Number(copy.id) + 1);
  }

  if (!copy.createdAt) {
    copy.createdAt = new Date();
  }

  // verzeker dat de samenstellingsvelden bestaan (voor batch-detail.ejs)
  copy.producedLots  = Array.isArray(copy.producedLots)  ? copy.producedLots  : [];
  copy.rawLots       = Array.isArray(copy.rawLots)       ? copy.rawLots       : [];
  copy.chemicalLots  = Array.isArray(copy.chemicalLots)  ? copy.chemicalLots  : [];

  records.push(copy);
  return copy;
}

/**
 * Alle batchrecords, nieuwste eerst.
 */
function getAllBatchRecords() {
  // kopie zodat externe code records[] niet kan aanpassen
  return [...records].sort((a, b) => {
    const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return db - da; // nieuwste eerst
  });
}

/**
 * Eén batch via id (string of nummer).
 */
function getBatchRecord(id) {
  if (id === undefined || id === null) return null;
  const numId = Number(id);
  return records.find(r => Number(r.id) === numId) || null;
}

/**
 * Optioneel helper om alles te wissen (handig bij tests).
 */
function clearAll() {
  records = [];
  nextId = 1;
}

module.exports = {
  // hoofd-API
  createBatchRecord,
  getAllBatchRecords,
  getBatchRecord,

  // alternatieve namen (makkelijk voor integratie met bestaande code)
  addBatch,
  getAllBatches: getAllBatchRecords,
  getBatchById: getBatchRecord,

  // util
  clearAll
};
