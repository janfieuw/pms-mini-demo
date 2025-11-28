// data/chemicals-data.js

// Simpele lijst artikelen_CHEM
const CHEMICAL_ARTICLES = [
  { id: "CH001", name: "Struktol SB 2052", stockAlertValue: 0 },
  { id: "CH002", name: "Struktol SB 413", stockAlertValue: 0 },

  { id: "CH003", name: "NaOH 50%", stockAlertValue: 0 },
  { id: "CH004", name: "NaOH 32%", stockAlertValue: 0 },

  { id: "CH005", name: "Tensacid SFZ", stockAlertValue: 0 },
  { id: "CH006", name: "Tensalc PRO", stockAlertValue: 0 },

  { id: "PA01", name: "BB Re:Source", stockAlertValue: 0 },
  { id: "PA02", name: "BB Blank", stockAlertValue: 0 }
];


// STOCK per artikel
// articleId -> { stockAlertValue, batches: [{ lotNumber, availableQuantity }] }
const chemicalStock = new Map();

// USED OVERVIEW (historiek)
// { id, articleId, lotNumber, startDate, endDate|null }
let chemicalUsage = [];
let nextUsageId = 1;

function getArticles() {
  return CHEMICAL_ARTICLES;
}

function getArticle(articleId) {
  return CHEMICAL_ARTICLES.find(a => a.id === articleId);
}

function ensureArticleStock(articleId) {
  if (!chemicalStock.has(articleId)) {
    const article = getArticle(articleId);
    chemicalStock.set(articleId, {
      articleId,
      stockAlertValue: article?.stockAlertValue ?? 0,
      batches: []
    });
  }
  return chemicalStock.get(articleId);
}

// ---------- INBOUND ----------
function addInboundLines(lines) {
  // lines: [{ articleId, lotNumber, quantity }]
  lines.forEach(line => {
    const qty = parseInt(line.quantity, 10);
    if (!line.articleId || !line.lotNumber || !qty || qty <= 0) return;

    const stock = ensureArticleStock(line.articleId);
    let batch = stock.batches.find(b => b.lotNumber === line.lotNumber);
    if (batch) {
      batch.availableQuantity += qty;
    } else {
      stock.batches.push({
        lotNumber: line.lotNumber,
        availableQuantity: qty
      });
    }
  });
}

// ---------- STOCK ----------
function setStockAlert(articleId, value) {
  const stock = ensureArticleStock(articleId);
  stock.stockAlertValue = parseInt(value, 10) || 0;
}

function getStockOverview() {
  return getArticles().map(article => {
    const stock = ensureArticleStock(article.id);
    const totalAvailable = stock.batches.reduce(
      (sum, b) => sum + b.availableQuantity,
      0
    );

    // Jouw logica:
    // - groen als stock >= alert
    // - rood als stock < alert
    const isBelowAlert = totalAvailable < stock.stockAlertValue;

    return {
      articleId: article.id,
      articleName: article.name,
      stockAlertValue: stock.stockAlertValue,
      totalAvailable,
      isBelowAlert,
      batches: stock.batches
        .slice()
        .sort((a, b) => a.lotNumber.localeCompare(b.lotNumber))
    };
  });
}

// ---------- SWITCH ----------
function getActiveUsageBlock(articleId) {
  return chemicalUsage.find(
    u => u.articleId === articleId && u.endDate == null
  );
}

function getAvailableBatchesForSwitch(articleId) {
  const stock = ensureArticleStock(articleId);
  return stock.batches.filter(b => b.availableQuantity > 0);
}

function switchBatch({ articleId, newLotNumber, timestamp }) {
  const stock = ensureArticleStock(articleId);
  const batch = stock.batches.find(b => b.lotNumber === newLotNumber);

  if (!batch || batch.availableQuantity <= 0) {
    throw new Error('Batch niet beschikbaar');
  }

  const now = timestamp || new Date();

  // sluit huidige blok (als het bestaat)
  const active = getActiveUsageBlock(articleId);
  if (active) {
    active.endDate = now;
  }

  // nieuw blok openen
  chemicalUsage.push({
    id: nextUsageId++,
    articleId,
    lotNumber: newLotNumber,
    startDate: now,
    endDate: null
  });

  // automatisch 1 stuk afboeken
  batch.availableQuantity -= 1;
}

// ---------- USED OVERVIEW ----------
function getUsageOverview() {
  // sorteer op startdatum desc
  return chemicalUsage
    .slice()
    .sort((a, b) => b.startDate - a.startDate)
    .map(u => ({
      ...u,
      articleName: getArticle(u.articleId)?.name || u.articleId
    }));
}

module.exports = {
  getArticles,
  getArticle,
  addInboundLines,
  setStockAlert,
  getStockOverview,
  getAvailableBatchesForSwitch,
  getActiveUsageBlock,
  switchBatch,
  getUsageOverview
};
