const express = require('express');
const router = express.Router();

const chemicals = require('../data/chemicals-data');

// Zorg dat je sessies al geconfigureerd hebt in server.js
// inbound-lijnen houden we tijdelijk in de sessie

// ---------- INBOUND ----------

// GET /chemicals/inbound
router.get('/inbound', (req, res) => {
  const tempLines = req.session.chemInboundLines || [];
  res.render('pages/chemicals/chemicals-inbound', {
    articles: chemicals.getArticles(),
    tempLines
  });
});

// POST /chemicals/inbound/add-line
router.post('/inbound/add-line', (req, res) => {
  const { articleId, lotNumber, quantity } = req.body;

  const lines = req.session.chemInboundLines || [];
  lines.push({
    articleId,
    lotNumber,
    quantity: parseInt(quantity, 10) || 0
  });
  req.session.chemInboundLines = lines;

  res.redirect('/chemicals/inbound');
});

// POST /chemicals/inbound/commit
router.post('/inbound/commit', (req, res) => {
  const lines = req.session.chemInboundLines || [];
  chemicals.addInboundLines(lines);
  req.session.chemInboundLines = [];

  // eventueel flash message meegeven
  res.redirect('/chemicals/stock');
});

// ---------- STOCK ----------

// GET /chemicals/stock
router.get('/stock', (req, res) => {
  const stock = chemicals.getStockOverview();
  res.render('pages/chemicals/chemicals-stock', { stock });
});

// POST /chemicals/stock/:articleId/alert
router.post('/stock/:articleId/alert', (req, res) => {
  const { articleId } = req.params;
  const { stockAlertValue } = req.body;

  chemicals.setStockAlert(articleId, stockAlertValue);
  res.redirect('/chemicals/stock');
});

// ---------- SWITCH ----------

// GET /chemicals/switch
router.get('/switch', (req, res) => {
  const stockOverview = chemicals.getStockOverview();

  const viewModel = stockOverview.map(item => {
    const activeBlock = chemicals.getActiveUsageBlock(item.articleId);
    const availableBatches = chemicals.getAvailableBatchesForSwitch(
      item.articleId
    );

    return {
      ...item,
      activeUsage: activeBlock,      // { lotNumber, startDate, ... } of null
      availableBatches               // batches met quantity > 0
    };
  });

  res.render('pages/chemicals/chemicals-switch', {
    articles: viewModel
  });
});

// POST /chemicals/switch
router.post('/switch', (req, res) => {
  const { articleId, newLotNumber } = req.body;

  try {
    chemicals.switchBatch({
      articleId,
      newLotNumber,
      timestamp: new Date()
    });
  } catch (err) {
    console.error(err);
    // TODO: error-afhandeling in UI (flash message)
  }

  res.redirect('/chemicals/switch');
});

// ---------- USED OVERVIEW ----------

// GET /chemicals/used
router.get('/used', (req, res) => {
  const used = chemicals.getUsageOverview();
  res.render('pages/chemicals/chemicals-used', { used });
});

module.exports = router;
