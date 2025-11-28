// routes/team.js
const express = require('express');
const router = express.Router();

// --- Auth guard ---
router.use((req, res, next) => {
  if (!req.session || !req.session.user) return res.redirect('/login');
  next();
});

// --- In-memory store ---
function getStore(app){
  if (!app.locals.teamStore){
    app.locals.teamStore = {
      schedule: {},
      absences: [],
      replacements: []
    };
  }
  return app.locals.teamStore;
}

// --- Helpers ---
function monthYearFromQuery(q){
  let { month, year } = q || {};
  const now = new Date();
  const mm = String((month || (now.getMonth()+1))).padStart(2,'0');
  const yy = String(year || now.getFullYear());
  return { month:mm, year:yy };
}
function ymd(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1);
  const day = String(d.getDate());
  const mm = m.padStart(2,'0');
  const dd = day.padStart(2,'0');
  return `${y}-${mm}-${dd}`;
}
function dow(d){ return d.getDay(); }
function daysInMonth(year, month){ return new Date(year, month, 0).getDate(); }
function pushShift(store, date, shift, user, start, end){
  store.schedule[date] = store.schedule[date] || [];
  const exists = store.schedule[date].some(x => x.shift===shift && x.user===user);
  if (!exists){
    store.schedule[date].push({
      shift,
      user,
      state: 'yellow',
      start,
      end,
      originalUser: user,
      coverUser: null
    });
  }
}

// --- Auto-fill rules ---
function ensureMonthSeed(store, month, year){
  const prefix = `${year}-${month}-`;
  const already = Object.keys(store.schedule).some(d => d.startsWith(prefix));
  if (already) return;

  const y = parseInt(year,10);
  const m = parseInt(month,10);
  const dim = daysInMonth(y, m);

  for (let day=1; day<=dim; day++){
    const d = new Date(y, m-1, day);
    const dateStr = ymd(d);
    const w = dow(d);

    if (w>=1 && w<=5){
      pushShift(store, dateStr, '05-13', 'JFI', '05:00', '13:00');
      pushShift(store, dateStr, '13-21', 'FCO', '13:00', '21:00');
    }
    if (w>=0 && w<=3){
      pushShift(store, dateStr, '21-05', 'CVD', '21:00', '05:00');
    }
    if (w===5){ pushShift(store, dateStr, '21-09', 'TDA', '21:00', '09:00'); }
    if (w===6){ pushShift(store, dateStr, '21-05', 'TDA', '21:00', '05:00'); }
    if (w===6 || w===0){
      pushShift(store, dateStr, '09-21', 'DDS', '09:00', '21:00');
    }
  }
}

function filterSchedule(store, month, year){
  const rows = [];
  Object.entries(store.schedule).forEach(([date, items]) => {
    if (!date.startsWith(`${year}-${month}-`)) return;
    (items||[]).forEach(it => {
      rows.push({
        date,
        shift: it.shift,
        user: it.user || '',
        state: it.state,
        start: it.start,
        end: it.end
      });
    });
  });
  return rows.sort((a,b)=>
    (a.date+a.shift+a.user).localeCompare(b.date+b.shift+b.user)
  );
}
function listAbsencesAll(store){
  return (store.absences||[])
    .slice()
    .sort((a,b)=> (b.date+b.shift).localeCompare(a.date+a.shift));
}
function listReplacementsAll(store){
  return (store.replacements||[])
    .slice()
    .sort((a,b)=> (b.date+b.shift).localeCompare(a.date+a.shift));
}

// --- SCHEDULE ---
router.get('/schedule', (req, res) => {
  const store = getStore(req.app);
  const { month, year } = monthYearFromQuery(req.query);
  ensureMonthSeed(store, month, year);
  const rows = filterSchedule(store, month, year);
  res.render('pages/team/schedule', {
    month,
    year,
    rows,
    raw: {
      columns: ['date','shift','user','state','start','end'],
      rows: rows.map(r => [r.date,r.shift,r.user,r.state,r.start,r.end])
    }
  });
});

// Mark Absent
router.post('/schedule/mark-absent', express.urlencoded({extended:true}), (req,res)=>{
  const store = getStore(req.app);
  const { date, shift } = req.body || {};
  if (!date || !shift) return res.redirect('back');

  const day = store.schedule[date] || [];
  const item = day.find(x => x.shift === shift);
  if (item){
    item.state = 'white-empty';
    item.user = '';
    const existing = store.absences.find(a => a.date===date && a.shift===shift);
    if (!existing){
      store.absences.push({
        date,
        shift,
        originalUser: item.originalUser || '',
        approved: false
      });
    } else {
      existing.approved = false;
    }
  }
  return res.redirect('back');
});

// ABSENCES LIST
router.get('/absences', (req, res) => {
  const store = getStore(req.app);
  const rows = listAbsencesAll(store);
  res.render('pages/team/absences', {
    rows,
    raw: {
      columns:['date','shift','originalUser','status','approved'],
      rows: rows.map(r => [r.date,r.shift,r.originalUser,'absent', r.approved?1:0])
    }
  });
});

// Fill cover
router.post('/absences/fill', express.urlencoded({extended:true}), (req,res)=>{
  const store = getStore(req.app);
  const { date, shift, coverUser } = req.body || {};
  if (!date || !shift || !coverUser) return res.redirect('back');

  const day = store.schedule[date] || [];
  let item = day.find(x => x.shift === shift);
  if (!item){
    item = {
      shift,
      user: '',
      state: 'white-empty',
      originalUser: '',
      coverUser: null
    };
    day.push(item);
    store.schedule[date] = day;
  }
  item.state = 'white-code';
  item.user = coverUser;
  item.coverUser = coverUser;

  let abs = store.absences.find(a => a.date===date && a.shift===shift);
  if (!abs){
    abs = {
      date,
      shift,
      originalUser: item.originalUser || '',
      approved: true
    };
    store.absences.push(abs);
  } else {
    abs.approved = true;
  }

  const idx = store.replacements.findIndex(r => r.date===date && r.shift===shift);
  const entry = {
    date,
    shift,
    originalUser: item.originalUser || '',
    coverUser,
    createdAt: new Date()
  };
  if (idx>=0) store.replacements[idx] = entry;
  else store.replacements.push(entry);

  return res.redirect('back');
});

// REPLACEMENTS LIST
router.get('/replacements', (req, res) => {
  const store = getStore(req.app);
  const rows = listReplacementsAll(store);
  res.render('pages/team/replacements', {
    rows,
    raw: {
      columns:['date','shift','originalUser','coverUser'],
      rows: rows.map(r => [r.date,r.shift,r.originalUser||'',r.coverUser||''])
    }
  });
});

// Undo replacement
router.post('/replacements/undo', express.urlencoded({extended:true}), (req,res)=>{
  const store = getStore(req.app);
  const { date, shift } = req.body || {};
  if (!date || !shift) return res.redirect('back');

  const day = store.schedule[date] || [];
  const item = day.find(x => x.shift === shift);
  if (item){
    item.state = 'white-empty';
    item.user = '';
    item.coverUser = null;
  }

  store.replacements =
    (store.replacements || [])
      .filter(r => !(r.date===date && r.shift===shift));

  const abs = (store.absences||[])
    .find(a => a.date===date && a.shift===shift);
  if (abs) abs.approved = false;

  return res.redirect('back');
});

/* =====================================================================
   WORK PERFORMANCE
   Filters + export
   ===================================================================== */

const OPERATORS = ['CVD','DDS','DTH','EDG','FCO','FVW','JFI','TDA'];

function parseStartDateFromLabel(label){
  if (!label) return null;
  const m = label.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { day:m[1], month:m[2], year:m[3] };
}

router.get('/work-performance', (req, res) => {

  const allShifts = (req.app.locals && Array.isArray(req.app.locals.shifts))
    ? req.app.locals.shifts
    : [];

  const { month, year } = monthYearFromQuery(req.query);
  let operator = (req.query.operator || '-ALL-').toUpperCase();
  if (!OPERATORS.includes(operator)) operator = '-ALL-';

  const filtered = allShifts.filter(s => {
    const parsed = parseStartDateFromLabel(s.startLabel);
    if (!parsed) return false;
    if (parsed.month !== month || parsed.year !== year) return false;
    if (operator !== '-ALL-') {
      return (s.operator || '').toUpperCase() === operator;
    }
    return true;
  });

  res.render('pages/team/work-performance', {
    layout: 'layout',
    user: req.session.user || null,
    items: filtered,
    filter: { month, year, operator },
    operators: OPERATORS
  });
});

// EXPORT (schedule / absences / replacements / work-performance)
router.get('/export', (req, res) => {
  const store = getStore(req.app);
  const { page='schedule' } = req.query;
  let data;

  if (page === 'absences'){
    const rows = listAbsencesAll(store);
    data = {
      columns:['date','shift','originalUser','status','approved'],
      rows: rows.map(r=>[r.date,r.shift,r.originalUser,'absent', r.approved?1:0])
    };

  } else if (page === 'replacements'){
    const rows = listReplacementsAll(store);
    data = {
      columns:['date','shift','originalUser','coverUser'],
      rows: rows.map(r=>[r.date,r.shift,r.originalUser||'',r.coverUser||''])
    };

  } else if (page === 'work-performance') {
    // Export van /team/work-performance (gefilterde shifts)
    const allShifts = (req.app.locals && Array.isArray(req.app.locals.shifts))
      ? req.app.locals.shifts
      : [];

    const { month, year } = monthYearFromQuery(req.query);
    let operator = (req.query.operator || '-ALL-').toUpperCase();
    if (!OPERATORS.includes(operator)) operator = '-ALL-';

    const filtered = allShifts.filter(s => {
      const parsed = parseStartDateFromLabel(s.startLabel);
      if (!parsed) return false;
      if (parsed.month !== month || parsed.year !== year) return false;
      if (operator !== '-ALL-') {
        return (s.operator || '').toUpperCase() === operator;
      }
      return true;
    });

    // totale minuten & HH:MM per rij
    const rows = filtered.map(s => {
      let minutes = 0;
      let hhmm = '';

      if (s.startLabel && s.logoutAt) {
        const re = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2}):(\d{2})/;
        const m1 = s.startLabel.match(re);
        const m2 = s.logoutAt.match(re);
        if (m1 && m2) {
          const d1 = new Date(`${m1[3]}-${m1[2]}-${m1[1]}T${m1[4]}:${m1[5]}:00`);
          const d2 = new Date(`${m2[3]}-${m2[2]}-${m2[1]}T${m2[4]}:${m2[5]}:00`);
          if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
            minutes = Math.max(0, Math.round((d2 - d1) / 60000));
            const h = Math.floor(minutes / 60);
            const m = minutes % 60;
            hhmm = `${h}h${String(m).padStart(2,'0')}min`;
          }
        }
      }

      return [
        s.operator || '',
        s.startLabel || '',
        s.endLabel || '',
        s.logoutAt || '',
        minutes,
        hhmm
      ];
    });

    data = {
      columns:['operator','startLabel','endLabel','logoutAt','totalMinutes','totalHHMM'],
      rows
    };

  } else {
    // default: schedule
    const { month, year } = monthYearFromQuery(req.query);
    ensureMonthSeed(store, month, year);
    const rows = filterSchedule(store, month, year);
    data = {
      columns:['date','shift','user','state','start','end'],
      rows: rows.map(r=>[r.date,r.shift,r.user,r.state,r.start,r.end])
    };
  }

  let html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><table><thead><tr>';
  data.columns.forEach(c=> { html += `<th>${String(c)}</th>`; });
  html += '</tr></thead><tbody>';
  data.rows.forEach(r => {
    html += '<tr>';
    data.columns.forEach((_,i)=> {
      html += `<td>${ (r[i]==null ? '' : String(r[i])) }</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table></body></html>';

  let fn;
  if (page === 'work-performance') {
    const { month, year } = monthYearFromQuery(req.query);
    const op = (req.query.operator || '-ALL-').toUpperCase();
    fn = `TEAM_WORK-PERFORMANCE_${year}-${month}_${op}.xls`;
  } else if (page === 'schedule') {
    const { month, year } = monthYearFromQuery(req.query);
    fn = `TEAM_${page.toUpperCase()}_${year}-${month}.xls`;
  } else {
    fn = `TEAM_${page.toUpperCase()}_ALL.xls`;
  }

  res.setHeader('Content-Type','application/vnd.ms-excel');
  res.setHeader('Content-Disposition',`attachment; filename="${fn}"`);
  return res.send(html);
});

module.exports = router;
