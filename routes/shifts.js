const express = require('express');
const router = express.Router();

// Single source of truth for store per request
router.use((req, res, next) => {
  req.store = (req.app && req.app.locals) ? req.app.locals.store : null;
  next();
});

// In-memory shifts array
const shifts = [];

// Make shifts available globally (TEAM uses this)
router.use((req, res, next) => {
  if (req.app && req.app.locals) {
    req.app.locals.shifts = shifts;
  }
  next();
});

const TARGET_PER_HOUR = 2400; // doel uit jouw Excel
const QC_TARGET       = 2;    // target aantal QC checks

// Helpers
function pad(n) { return String(n).padStart(2, '0'); }
function fmtDate(d = new Date()) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtTime(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function currentCode(res) {
  return res.locals.currentUser?.code || 'DEMO';
}

function currentOpenShift(code) {
  return shifts.find(s => s.operator === code && !s.endLabel);
}

function parseLabelToDate(label) {
  if (!label || typeof label !== 'string') return null;
  // vb: "START: 27/11/2025 - 15:57"
  const m = label.match(/:\s*(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m;
  const iso = `${yyyy}-${mm}-${dd}T${hh}:${min}:00`;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function minutesBetween(a, b) {
  if (!(a instanceof Date) || !(b instanceof Date)) return 0;
  return Math.max(0, Math.round((b - a) / 60000));
}

// gebruik enkel het uur: "18:00" → zelfde datum als startD
function projectToShiftDay(startD, timeStr) {
  if (!(startD instanceof Date) || !timeStr) return null;
  const m = String(timeStr).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const d = new Date(startD);
  d.setHours(hh, mm, 0, 0);
  return d;
}

// downtime + QUALITY CHECKS
function computeDowntimeAndQC(messages, startD, endD) {
  try {
    if (!Array.isArray(messages)) {
      return { downtimeMin: 0, qcPercent: 0, qcChecks: 0, intervals: [] };
    }

    const startTs = startD?.getTime();
    const endTs   = endD?.getTime();
    if (!startTs || !endTs) {
      return { downtimeMin: 0, qcPercent: 0, qcChecks: 0, intervals: [] };
    }

    // beperk berichten tot shift-window
    const within = messages
      .map(m => ({ m, ts: projectToShiftDay(startD, m.time)?.getTime() || null }))
      .filter(x => x.ts && x.ts >= startTs && x.ts <= endTs)
      .sort((a, b) => a.ts - b.ts);

    let downStart = null;
    let downtimeMs = 0;
    const intervals = [];

    // DOWNTIME via START/STOP
    for (const { m, ts } of within) {
      const kind = (m.calc || '').toUpperCase();
      if (kind === 'STOP' && downStart == null) {
        downStart = ts;
      } else if (kind === 'START' && downStart != null) {
        downtimeMs += (ts - downStart);
        intervals.push({
          from: downStart,
          to: ts,
          minutes: Math.max(0, Math.round((ts - downStart) / 60000))
        });
        downStart = null;
      }
    }

    // open downtime tot einde shift
    if (downStart != null) {
      downtimeMs += (endTs - downStart);
      intervals.push({
        from: downStart,
        to: endTs,
        minutes: Math.max(0, Math.round((endTs - downStart) / 60000))
      });
    }

    const downtimeMin = Math.max(0, Math.round(downtimeMs / 60000));

    // QUALITY CHECKS: detecteer QC-berichten
    const qcCount = within.filter(({ m }) => {
      const calc       = String(m.calc   || '').toUpperCase();
      const label      = String(m.label  || '').toUpperCase();
      const domain     = String(m.domain || '').toUpperCase();
      const text       = String(m.text   || '').toUpperCase();
      const qcField    = String(m.qc     || '').toUpperCase();   // <─ BELANGRIJK: van form.ejs
      const infoLabels = Array.isArray(m.infoLabels)
        ? m.infoLabels.map(x => String(x).toUpperCase())
        : [];

      if (qcField === 'QC' || qcField === 'QUALITY' || qcField === 'QUALITY CHECK') return true;

      if (calc === 'QC' || calc === 'QUALITY' || calc === 'QUALITY CHECK') return true;
      if (domain === 'QUALITY' || domain === 'QUALITY CHECK') return true;
      if (label === 'QC' || label.includes('QUALITY CHECK') || label.includes('QUALITY')) return true;
      if (text.includes('QUALITY CHECK') || text.includes('[QC]')) return true;
      if (infoLabels.includes('QC') || infoLabels.includes('QUALITY') || infoLabels.includes('QUALITY CHECK')) return true;

      return false;
    }).length;

    // we houden qcPercent nog bij, maar op de pagina toon je QUALITY altijd 100%
    const qcPercent = qcCount >= 2 ? 100 : (qcCount === 1 ? 50 : 0);

    return { downtimeMin, qcPercent, qcChecks: qcCount, intervals };

  } catch (e) {
    return { downtimeMin: 0, qcPercent: 0, qcChecks: 0, intervals: [] };
  }
}

// BB → vanuit app.locals.bbDischarges
function computeBbKgForShift(discharges, siloName, startLabel, endLabel) {
  if (!Array.isArray(discharges)) return 0;
  const startD = parseLabelToDate(startLabel);
  const endD   = parseLabelToDate(endLabel);
  if (!startD || !endD) return 0;

  const startTs = startD.getTime();
  const endTs   = endD.getTime();
  const silo    = siloName.toUpperCase();

  return discharges.reduce((sum, d) => {
    if (!d) return sum;
    if (String(d.originSilo || '').toUpperCase() !== silo) return sum;
    const created = new Date(d.createdAt);
    const ts = created.getTime();
    if (ts >= startTs && ts <= endTs) {
      const kg = Number(d.quantityKg || 0);
      if (!isNaN(kg)) sum += kg;
    }
    return sum;
  }, 0);
}

// BULK → vanuit app.locals.store.bulkDeliveries
function computeBulkKgForShift(bulk, siloNumber, startLabel, endLabel) {
  if (!Array.isArray(bulk)) return 0;

  const startD = parseLabelToDate(startLabel);
  const endD   = parseLabelToDate(endLabel);
  if (!startD || !endD) return 0;

  const startTs = startD.getTime();
  const endTs   = endD.getTime();

  return bulk.reduce((sum, rec) => {
    if (String(rec.silo) !== String(siloNumber)) return sum;

    const created = new Date(rec.created_at);
    const ts = created.getTime();
    if (ts >= startTs && ts <= endTs) {
      const kg = Number(rec.kg || 0);
      if (!isNaN(kg)) sum += kg;
    }
    return sum;
  }, 0);
}

function tsToHHMM(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// -------------------- START SHIFT --------------------
router.get('/start', (req, res) => {
  const startDefaults = { time: fmtTime(), day: fmtDate(), statusUp: true };
  res.render('pages/shifts/start', {
    startDefaults,
    currentShift: currentOpenShift(currentCode(res)),
    currentUser: res.locals.currentUser,
    page: 'new'
  });
});

router.post('/start', (req, res) => {
  const code = currentCode(res);
  if (currentOpenShift(code)) return res.redirect('/shifts/stop/step1');

  const id = shifts.length + 1;
  const startLabel = `START: ${req.body.day} - ${req.body.time}`;

  shifts.push({
    id,
    operator: code,
    startLabel
  });

  // status uit formulier halen (UP / DOWN), default = UP
  const chosenStatus =
    (req.body.status || '').toUpperCase() === 'DOWN' ? 'DOWN' : 'UP';

  if (req.store) {
    req.store.shiftState = {
      user: code,
      startHHMM: req.body.time,
      status: chosenStatus,
      downtime: 0,
      lastStopHHMM: chosenStatus === 'DOWN' ? req.body.time : null
    };
  }

  // Als shift met DOWN start: meteen STOP-bericht loggen
  const store = req.app && req.app.locals ? req.app.locals.store : null;
  if (chosenStatus === 'DOWN' && store && Array.isArray(store.messages)) {
    store.messages.unshift({
      id: Date.now().toString(),
      label: 'STOP',
      text: 'Auto STOP (shift started DOWN)',
      time: req.body.time,
      day: req.body.day,
      calc: 'STOP',
      by: code,
      createdAt: new Date()
    });
  }

  return res.redirect('/shifts/overview');
});

// -------------------- STOP STEP 1 --------------------
router.get('/stop', (req, res) => res.redirect('/shifts/stop/step1'));

router.get('/stop/step1', (req, res) => {
  const s = currentOpenShift(currentCode(res));
  if (!s) return res.redirect('/shifts/start');
  const stopDefaults = { time: fmtTime(), day: fmtDate(), statusUp: true };
  res.render('pages/shifts/stop-step1', { stopDefaults, page: 'stop' });
});

router.post('/stop/step1', (req, res) => {
  const s = currentOpenShift(currentCode(res));
  if (!s) return res.redirect('/shifts/start');

  const { day, time } = req.body;
  s.endLabel = `END: ${day} - ${time}`;

  if (req.store) req.store.shiftState = null;
  return res.redirect('/shifts/stop/step2-produced');
});

// -------------------- STOP STEP 2 – ALLES OP 1 PAGINA --------------------
router.get('/stop/step2-produced', (req, res) => {
  const code = currentCode(res);
  const current = currentOpenShift(code) || shifts.slice(-1)[0];

  if (!current || !current.startLabel || !current.endLabel) {
    return res.redirect('/shifts/start');
  }

  let prev = null;
  if (current) {
    const i = shifts.indexOf(current);
    prev = i > 0 ? shifts[i - 1] : null;
  }

  const start710 = current?.start710 ?? prev?.stop710 ?? 0;
  const start720 = current?.start720 ?? prev?.stop720 ?? 0;

  const bb    = req.app.locals.bbDischarges || [];
  const store = req.app.locals.store || {};
  const bulk  = store.bulkDeliveries || [];

  const d710bb   = computeBbKgForShift(bb, 'SILO 710', current.startLabel, current.endLabel);
  const d720bb   = computeBbKgForShift(bb, 'SILO 720', current.startLabel, current.endLabel);
  const d710bulk = computeBulkKgForShift(bulk, '710', current.startLabel, current.endLabel);
  const d720bulk = computeBulkKgForShift(bulk, '720', current.startLabel, current.endLabel);

  const produced = {
    start710, start720,
    stop710: current?.stop710 ?? 0,
    stop720: current?.stop720 ?? 0,
    d_710_bulk: d710bulk,
    d_720_bulk: d720bulk,
    d_710_bb: d710bb,
    d_720_bb: d720bb
  };

  // downtime + QC → paarse vakken
  const startD = parseLabelToDate(current.startLabel);
  const endD   = parseLabelToDate(current.endLabel);
  const shiftTimeMin = minutesBetween(startD, endD);

  const messages = store.messages || [];
  const calc = computeDowntimeAndQC(messages, startD, endD);

  const intervals = (calc.intervals || []).map(iv => ({
    from: tsToHHMM(iv.from),
    to:   tsToHHMM(iv.to),
    minutes: iv.minutes
  }));

  const uptimePercent = shiftTimeMin > 0
    ? 100 * (1 - (calc.downtimeMin / shiftTimeMin))
    : 0;

  const metrics = {
    hasResult: false,
    producedTotal: 0,
    shiftTimeMin,
    downtimeMin: calc.downtimeMin,
    uptimePercent,
    producedPerHour: 0,
    targetPerHour: TARGET_PER_HOUR,
    performancePercent: 0,
    qcChecks: calc.qcChecks || 0,
    qcTarget: QC_TARGET,
    qualityPercent: 100, // op scherm altijd 100%
    oeePercent: 0,
    intervals
  };

  res.render('pages/shifts/stop-step2-produced', {
    produced,
    metrics,
    page: 'stop'
  });
});

router.post('/stop/step2-produced', (req, res) => {
  const mode = req.body.mode || 'confirm';
  const s = shifts.slice(-1)[0];
  if (!s) return res.redirect('/shifts/start');

  // gewichten uit formulier
  s.start710 = Number(req.body.start710 || 0);
  s.start720 = Number(req.body.start720 || 0);
  s.stop710  = Number(req.body.stop710  || 0);
  s.stop720  = Number(req.body.stop720  || 0);

  const store = req.app.locals.store || {};
  const bb    = req.app.locals.bbDischarges || [];
  const bulk  = store.bulkDeliveries || [];

  s.d_710_bb   = computeBbKgForShift(bb, 'SILO 710', s.startLabel, s.endLabel);
  s.d_720_bb   = computeBbKgForShift(bb, 'SILO 720', s.startLabel, s.endLabel);
  s.d_710_bulk = computeBulkKgForShift(bulk, '710', s.startLabel, s.endLabel);
  s.d_720_bulk = computeBulkKgForShift(bulk, '720', s.startLabel, s.endLabel);

  s.produced =
      (s.stop710 - s.start710)
    + (s.stop720 - s.start720)
    + s.d_710_bb + s.d_720_bb
    + s.d_710_bulk + s.d_720_bulk;

  const startD = parseLabelToDate(s.startLabel);
  const endD   = parseLabelToDate(s.endLabel);
  const shiftTimeMin = minutesBetween(startD, endD);

  const messages = store.messages || [];
  const calc = computeDowntimeAndQC(messages, startD, endD);

  const uptimePercent = shiftTimeMin > 0
    ? 100 * (1 - (calc.downtimeMin / shiftTimeMin))
    : 0;

  const producedPerHour = shiftTimeMin > 0
    ? (s.produced * 60 / shiftTimeMin)
    : 0;

  const performancePercent = TARGET_PER_HOUR > 0
    ? 100 * (producedPerHour / TARGET_PER_HOUR)
    : 0;

  // QUALITY: altijd 100%
  const qualityPercent = 100;
  const oeePercent = (uptimePercent / 100) * (performancePercent / 100) * (qualityPercent / 100) * 100;

  // alles op shift bewaren
  s.downtime = calc.downtimeMin;
  s.qc       = qualityPercent;
  s.oee      = oeePercent;

  const intervals = (calc.intervals || []).map(iv => ({
    from: tsToHHMM(iv.from),
    to:   tsToHHMM(iv.to),
    minutes: iv.minutes
  }));

  const metrics = {
    hasResult: true,
    producedTotal: s.produced,
    shiftTimeMin,
    downtimeMin: calc.downtimeMin,
    uptimePercent,
    producedPerHour,
    targetPerHour: TARGET_PER_HOUR,
    performancePercent,
    qcChecks: calc.qcChecks || 0,
    qcTarget: QC_TARGET,
    qualityPercent,
    oeePercent,
    intervals
  };

  const produced = {
    start710: s.start710,
    start720: s.start720,
    stop710:  s.stop710,
    stop720:  s.stop720,
    d_710_bulk: s.d_710_bulk,
    d_720_bulk: s.d_720_bulk,
    d_710_bb:   s.d_710_bb,
    d_720_bb:   s.d_720_bb
  };

  if (mode === 'finish') {
    if (req.store) req.store.shiftState = null;
    return res.redirect('/shifts/overview');
  }

  res.render('pages/shifts/stop-step2-produced', {
    produced,
    metrics,
    page: 'stop'
  });
});

// -------------------- OUDERE STOP-STAPPEN (fallback) --------------------
router.get('/stop/step3', (req, res) => {
  return res.redirect('/shifts/stop/step2-produced');
});

router.post('/stop/step3', (req, res) => {
  return res.redirect('/shifts/stop/step2-produced');
});

router.post('/stop/confirm-oee', (req, res) => {
  if (req.store) req.store.shiftState = null;
  return res.redirect('/shifts/overview');
});

// -------------------- DEBUG: BULK & BB PER SHIFT --------------------
router.get('/debug-bulk-bb', (req, res) => {
  const code   = currentCode(res);
  const shift  = currentOpenShift(code) || shifts.slice(-1)[0] || null;

  const store   = req.app && req.app.locals ? (req.app.locals.store || {}) : {};
  const bulkAll = Array.isArray(store.bulkDeliveries) ? store.bulkDeliveries : [];
  const bbAll   = Array.isArray(req.app.locals.bbDischarges) ? req.app.locals.bbDischarges : [];

  let startD = null;
  let endD   = null;
  let startStr = null;
  let endStr   = null;

  let bulkInShift = [];
  let bbInShift   = [];

  const sums = {
    bulk710: 0,
    bulk720: 0,
    bb710:   0,
    bb720:   0
  };

  if (shift && shift.startLabel && shift.endLabel) {
    startD = parseLabelToDate(shift.startLabel);
    endD   = parseLabelToDate(shift.endLabel);
    startStr = startD ? startD.toISOString() : null;
    endStr   = endD   ? endD.toISOString()   : null;

    const startTs = startD ? startD.getTime() : null;
    const endTs   = endD   ? endD.getTime()   : null;

    if (startTs && endTs) {
      bulkInShift = bulkAll.filter(r => {
        const t = r && r.created_at ? new Date(r.created_at).getTime() : null;
        return t && t >= startTs && t <= endTs;
      });

      bbInShift = bbAll.filter(d => {
        const t = d && d.createdAt ? new Date(d.createdAt).getTime() : null;
        return t && t >= startTs && t <= endTs;
      });
    }

    sums.bulk710 = computeBulkKgForShift(bulkAll, '710',      shift.startLabel, shift.endLabel);
    sums.bulk720 = computeBulkKgForShift(bulkAll, '720',      shift.startLabel, shift.endLabel);
    sums.bb710   = computeBbKgForShift(bbAll,   'SILO 710',   shift.startLabel, shift.endLabel);
    sums.bb720   = computeBbKgForShift(bbAll,   'SILO 720',   shift.startLabel, shift.endLabel);
  }

  res.render('pages/shifts/debug-bulk-bb', {
    page: 'stop',
    shift,
    startLabel: shift ? shift.startLabel : null,
    endLabel:   shift ? shift.endLabel   : null,
    startStr,
    endStr,
    bulkAll,
    bbAll,
    bulkInShift,
    bbInShift,
    sums
  });
});

// -------------------- OVERVIEW --------------------
router.get('/overview', (req, res) => {
  const sorted = [...shifts].sort((a, b) => (b.id || 0) - (a.id || 0));
  res.render('pages/shifts/overview', {
    items: sorted,
    page: 'overview',
    activeDomain: 'SHIFTS'
  });
});

module.exports = router;
