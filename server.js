// =============================
// FEWR PMS - server.js
// =============================
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const bodyParser = require('body-parser');
const session    = require('express-session');
const layouts    = require('express-ejs-layouts');

// --- Uploads
const multer     = require('multer');
const crypto     = require('crypto');

const app = express();

// ---- Bestaande routers
const shiftRouter    = require('./routes/shifts');
const analysesRouter = require('./routes/analyses');

// ---- NIEUWE/EXTRA DOMEIN-ROUTERS
const teamRouter       = require('./routes/team');        // TEAM
const rawRouter        = require('./routes/raw');         // RAW MATERIALS
const chemicalsRouter  = require('./routes/chemicals');   // CHEMICALS
const bbRouter         = require('./routes/bb');          // BB WAREHOUSING + BATCH
const bulkRouter       = require('./routes/bulk');        // OUTBOUND BULK

// ---- App setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(layouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: 'pms-mini-secret',
  resave: false,
  saveUninitialized: false,
}));

// ---- Users
const USERS = [
  { code: 'JFI', name: 'Jan Fieuw',               password: '3009' },
  { code: 'DTH', name: 'Davinia Thoelen',         password: '3009' },
  { code: 'DDE', name: 'Dimitri Devos',           password: '3009' },
  { code: 'TDA', name: 'Tajib Diwan Ali',         password: '3009' },
  { code: 'CVD', name: 'Cliff Verdonck',          password: '3009' },
  { code: 'FCO', name: 'Florian Collier',         password: '3009' },
  { code: 'EDG', name: 'Ewoud De Gussem',         password: '3009' },
  { code: 'FVW', name: 'Floris Vande Walle',      password: '3009' },
  { code: 'PBR', name: 'Pieter Brodeoux',         password: '3009' },
  { code: 'JBR', name: 'Jelle Bryon',             password: '3009' },
  { code: 'TSW', name: 'Thomas Sweertvaegher',    password: '3009' },
  { code: 'JPE', name: 'Jana Petricevic',         password: '3009' },
];

// ---- In-memory store
const store = {
  messages: [],
  shiftState: null,       // { user, startHHMM, status, downtime, lastStopHHMM }
  mustRead: [],
  archive: [],
  todos: [],
  notebooks: {}
};
app.locals.store = store;

// ShiftState beschikbaar in elke view
app.use((req,res,next)=>{
  res.locals.shiftState = app.locals.store.shiftState || null;
  next();
});

// Standaard currentUser voor views
app.use((req, res, next) => {
  res.locals.currentUser = req.session?.user || { code: 'ANON' };
  next();
});

// ---- Utils
function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}
function nowHHmm() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function hhmmToMinutes(str) {
  const [h, m] = String(str || '00:00').split(':').map(n=>parseInt(n,10));
  return (h * 60) + m;
}

// ---- NAV structuur
const DOMAINS = [
  { key:'LOGBOOK', subs:[
    { key:'FORM',         path:'/logbook/form' },
    { key:'MESSAGES',     path:'/logbook/messages' },
    { key:'MUST-READ',    path:'/logbook/mustread' },
    { key:'MY-NOTEBOOK',  path:'/logbook/mynotebook' },
    { key:'ARCHIVE',      path:'/logbook/archive' },
  ]},
  { key:'SHIFTS', subs:[
    { key:'NEW SHIFT',        path:'/shifts/start' },
    { key:'STOP SHIFT',       path:'/shifts/stop' },
    { key:'SHIFTS OVERVIEW',  path:'/shifts/overview' },
  ]},
  // RAW MATERIALS – sleutel gelijk aan tertiary / activeDomain, inbound-raw pad
  { key:'RAW MATERIALS', subs:[
    { key:'RAW INBOUND',   path:'/raw/inbound-raw' },
    { key:'RAW OVERVIEW',  path:'/raw/overview' },
  ]},
  { key:'CHEMICALS', subs:[
    { key:'INBOUND CHEMICALS', path:'/chemicals/inbound' },
    { key:'CHEMICALS STOCK',   path:'/chemicals/stock' },
    { key:'CHEMICALS SWITCH',  path:'/chemicals/switch' },
    { key:'USED OVERVIEW',     path:'/chemicals/used-overview' },
  ]},

  // --- NIEUW DOMEIN BATCH (gebruikt bb-router, maar apart domein in grijze balk)
  { key:'BATCH', subs:[
    { key:'BATCH CREATION',  path:'/bb/batch' },
    { key:'BATCH OVERVIEW',  path:'/bb/batch-overview' },
  ]},

{ key:'BB WAREHOUSING', subs:[
  { key:'DISCHARGE',            path:'/bb/discharge' },
  { key:'DISCHARGE OVERVIEW',   path:'/bb/discharge-overview' },
  { key:'ALLOCATION',           path:'/bb/allocation' },
  { key:'LOADING',              path:'/bb/loading' },
  { key:'STOCK',                path:'/bb/stock' },
]},
  // OUTBOUND BULK – sleutel gelijk aan tertiary / activeDomain
  { key:'OUTBOUND BULK', subs:[
    { key:'BULK INBOUND',   path:'/bulk/registratie' },
    { key:'BULK OVERVIEW',  path:'/bulk/all' },
  ]},
  { key:'ANALYSES', subs:[
    { key:'MESSAGES FILTER',  path:'/analyses/messages-filter' },
    { key:'RAW FILTER',       path:'/analyses/filter' },
    { key:'OEE OVERVIEW',     path:'/analyses/overview-oee' },
    { key:'PRODUCTION',       path:'/analyses/production' },
  ]},
  // TEAM – hier alleen de default pagina voor de grijze TEAM-knop
  { key:'TEAM', subs:[
    { key:'TOPICS', path:'/team/topics' },
  ]},
];

// Actieve balken bepalen
app.use((req, res, next) => {
  res.locals.domains = DOMAINS;
  res.locals.currentUser = req.session.user || null;

  res.locals.activeDomain =
    req.path.startsWith('/logbook')    ? 'LOGBOOK' :
    req.path.startsWith('/topics')     ? 'TOPICS'  :
    req.path.startsWith('/shifts')     ? 'SHIFTS' :
    req.path.startsWith('/analyses')   ? 'ANALYSES' :
    req.path.startsWith('/team')       ? 'TEAM' :
    req.path.startsWith('/raw')        ? 'RAW MATERIALS' :
    req.path.startsWith('/chemicals')  ? 'CHEMICALS' :
    // BATCH eerst, zodat /bb/batch en /bb/batch/:id onder domein BATCH vallen
    req.path.startsWith('/bb/batch')   ? 'BATCH' :
    // andere BB-pagina's blijven onder BB WAREHOUSING
    req.path.startsWith('/bb')         ? 'BB WAREHOUSING' :
    req.path.startsWith('/bulk')       ? 'OUTBOUND BULK' :
    null;

  res.locals.tertiarySubs =
    DOMAINS.find(d => d.key === res.locals.activeDomain)?.subs || [];

  res.locals.requestPath = req.path;
  next();
});

// ---- LOGIN
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/logbook/form');
  res.render('pages/auth/login', { error:null, layout:false });
});

app.post('/login', (req, res) => {
  const { code, password } = req.body;
  const user = USERS.find(u => u.code.toUpperCase() === String(code||'').toUpperCase());
  if (!user || user.password !== password) {
    return res.render('pages/auth/login', { error:'Invalid credentials', layout:false });
  }
  req.session.user = { code:user.code, name:user.name };
  if (!store.notebooks[user.code]) store.notebooks[user.code] = [];
  return res.redirect('/logbook/form');
});

// =====================================================
// LOGOUT MET TIMESTAMP OPSLAG IN SHIFT
// =====================================================
app.post('/logout', (req, res) => {
  const user = req.session.user;
  if (user) {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2,'0');
    const mm = String(now.getMonth()+1).padStart(2,'0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2,'0');
    const min = String(now.getMinutes()).padStart(2,'0');
    const logoutLabel = `${dd}/${mm}/${yyyy} - ${hh}:${min}`;

    const shifts = req.app.locals.shifts || [];
    const last = [...shifts].reverse().find(s => s.operator === user.code);
    if (last) last.logoutAt = logoutLabel;
  }
  req.session.destroy(() => res.redirect('/login'));
});

// =============================
// UPLOADS
// =============================
const UP_PATH = path.join(__dirname, 'uploads');
if (!fs.existsSync(UP_PATH)) fs.mkdirSync(UP_PATH, { recursive:true });
app.use('/uploads', express.static(UP_PATH));

const storage = multer.diskStorage({
  destination:(req, file, cb) => cb(null, UP_PATH),
  filename:(req, file, cb) => {
    const time = Date.now();
    const rand = crypto.randomBytes(3).toString('hex');
    const parsed = path.parse(file.originalname || 'file');
    const safeBase = (parsed.name || 'file')
      .toLowerCase()
      .replace(/[^a-z0-9_\-]+/g,'-')
      .replace(/-+/g,'-')
      .slice(0,60);
    const ext = (parsed.ext||'').toLowerCase();
    cb(null, `${time}-${rand}-${safeBase}${ext}`);
  }
});

const ALLOWED = new Set([
  'image/png','image/jpeg','image/jpg','image/gif','image/webp',
  'application/pdf'
]);

function fileFilter(req,file,cb){
  if (ALLOWED.has(file.mimetype)) return cb(null,true);
  cb(new Error('Alleen afbeeldingen of PDF zijn toegestaan.'));
}

const upload = multer({
  storage,
  fileFilter,
  limits:{ fileSize:10*1024*1024, files:10 }
});

// =============================
// ROUTERS
// =============================
app.use('/shifts',    requireAuth, shiftRouter);
app.use('/analyses',  requireAuth, analysesRouter);
app.use('/team',      requireAuth, teamRouter);
app.use('/raw',       requireAuth, rawRouter);
app.use('/chemicals', requireAuth, chemicalsRouter);
app.use('/bb',        requireAuth, bbRouter);
app.use('/bulk',      requireAuth, bulkRouter);

// =============================
// HOME
// =============================
app.get('/', (req,res)=>{
  if (!req.session.user) return res.redirect('/login');
  return res.redirect('/logbook/form');
});
app.get('/logbook', (req,res)=> res.redirect('/logbook/form'));

// =============================
// LOGBOOK
// =============================
const logbookRouter = express.Router();

// --- FORM
logbookRouter.get('/form', requireAuth, (req,res)=>{
  res.render('pages/logbook/form', {
    error:null,
    old:{ labelCalc:'', timeHHMM:nowHHmm(), message:'' }
  });
});

// --- POST FORM
logbookRouter.post('/form', requireAuth, upload.array('attachments',10), (req,res)=>{
  const user = req.session.user;

  // originele tekst + genormaliseerde tekst
  const rawMessage = (req.body.message || '').trim();
  let message      = rawMessage;

  const labelCalc = (req.body.labelCalc || req.body.calc || '').trim();
  const timeHHMM  = (req.body.timeHHMM  || req.body.when || nowHHmm()).trim();

  const push         = (req.body.push || '').trim();
  const wms          = (req.body.wms || '').trim();
  const chemswitch   = (req.body.chemswitch || '').trim();   // CHEM-SWITCH
  const qc           = (req.body.qc || '').trim();           // QUALITY CHECK
  const maintenance  = (req.body.maintenance || '').trim();  // MAINTENANCE
  const chemib       = (req.body.chemib || '').trim();       // CHEM-IB
  const bulkob       = (req.body.bulkob || '').trim();       // BULK-OB
  const infoLabels   = (req.body.infoLabels || '').split(',').filter(Boolean);
  const software     = (req.body.softwareLabels || '').split(',').filter(Boolean);
  const notebookOnly = (req.body.notebookOnly === '1' || req.body.notebookOnly === 'on');

  // START-regel: nooit START zonder voorgaande STOP
  if (labelCalc === 'START') {
    const hasAnyStop = store.messages.some(m => m.calc === 'STOP');
    if (!hasAnyStop) {
      return res.status(400).render('pages/logbook/form',{
        error:"You can't add a START message without a previous STOP message",
        old:{ labelCalc, timeHHMM, message: rawMessage }
      });
    }
  }

  // BERICHT NORMALISEREN: hoofdletter + eindigt met .?! (indien tekst bestaat)
  if (message) {
    message = message.charAt(0).toUpperCase() + message.slice(1);
    if (!/[.!?]$/.test(message)) {
      message += '.';
    }
  }

  let deltaMin = null;
  if (labelCalc === 'START') {
    const startM = hhmmToMinutes(timeHHMM);
    const lastStop = store.messages.find(m => m.calc === 'STOP');
    if (lastStop) {
      const stopM  = hhmmToMinutes(lastStop.time);
      const adjStart = (startM >= stopM) ? startM : startM+1440;
      deltaMin = Math.round((adjStart-stopM)*10)/10;
    }
  }

  const attachments = (req.files||[]).map(f=>({
    name:f.originalname,
    mime:f.mimetype,
    size:f.size,
    href:`/uploads/${path.basename(f.filename)}`
  }));

  const entry = {
    id:Date.now().toString(),
    user:user.code,
    time:timeHHMM,
    message,
    infoLabels,
    software,
    calc:labelCalc,
    push,
    wms,
    chemswitch,        // CHEM-SWITCH opslaan
    qc,                // QUALITY CHECK opslaan
    maintenance,       // MAINTENANCE opslaan
    chemib,            // CHEM-IB opslaan
    bulkob,            // BULK-OB opslaan
    deltaMin,
    attachments,
    createdAt:new Date()
  };

  // NOTEBOOK ONLY
  if (notebookOnly) {
    (store.notebooks[user.code] ||= []).unshift({
      id:`nb-${entry.id}`,
      fromId:entry.id,
      message:entry.message,
      time:entry.time,
      infoLabels:entry.infoLabels || [],
      software:entry.software || [],
      calc:entry.calc || '',
      push:entry.push || '',
      wms:entry.wms || '',
      chemswitch:entry.chemswitch || '',
      qc:entry.qc || '',
      maintenance:entry.maintenance || '',
      chemib:entry.chemib || '',
      bulkob:entry.bulkob || '',
      attachments:entry.attachments || [],
      savedAt:new Date()
    });
    return res.redirect('/logbook/mynotebook');
  }

  // Normale message
  store.messages.unshift(entry);

  // SHIFT STATE
  if (store.shiftState) {
    if (entry.calc === 'STOP') {
      store.shiftState.status = 'DOWN';
      store.shiftState.lastStopHHMM = entry.time;
    }
    else if (entry.calc === 'START') {
      store.shiftState.status = 'UP';
      if (store.shiftState.lastStopHHMM && typeof entry.deltaMin==='number') {
        store.shiftState.downtime = (store.shiftState.downtime||0) + Math.max(0, Math.floor(entry.deltaMin));
        store.shiftState.lastStopHHMM = null;
      }
    }
  }

  // MUST-READ / SAFETY → MUST-READ + ARCHIVE
  if (push==='MUST-READ' || push==='SAFETY') {
    store.mustRead.unshift({ ...entry });
    store.archive.unshift({ ...entry });
  }

  // TODO's voor WMS, CHEM-SWITCH, CHEM-IB, BULK-OB
  if (wms) {
    const todoLink = (wms === 'IB-RAW') ? '/raw/inbound-raw' : '#';
    store.todos.unshift({
      id:`todo-${entry.id}`,
      user:user.code,
      label:wms,
      link: todoLink,
      createdAt:new Date()
    });
  }

  if (chemswitch) {
    store.todos.unshift({
      id:`todo-${entry.id}-chem-switch`,
      user:user.code,
      label:chemswitch,
      link:'/chemicals/switch',
      createdAt:new Date()
    });
  }

  if (chemib) {
    store.todos.unshift({
      id:`todo-${entry.id}-chem-ib`,
      user:user.code,
      label:chemib,
      link:'/chemicals/inbound',
      createdAt:new Date()
    });
  }

  if (bulkob) {
    store.todos.unshift({
      id:`todo-${entry.id}-bulk-ob`,
      user:user.code,
      label:bulkob,
      link:'/bulk/registratie',
      createdAt:new Date()
    });
  }

  // Redirect logica
  if (wms === 'IB-RAW') {
    return res.redirect('/raw/inbound-raw');
  }
  if (chemib === 'CHEM-IB') {
    return res.redirect('/chemicals/inbound');
  }
  if (bulkob === 'BULK-OB') {
    return res.redirect('/bulk/registratie');
  }
  if (chemswitch === 'CHEM-SWITCH') {
    return res.redirect('/chemicals/switch');
  }

  res.redirect('/logbook/form');
});

// --- MESSAGES
logbookRouter.get('/messages', requireAuth, (req,res)=>{
  const code = req.session.user.code;
  const nbIds = (store.notebooks[code]||[]).map(n=>n.fromId||n.id);
  res.render('pages/logbook/messages', { items:store.messages, notebooks:nbIds });
});

// --- MUST READ
logbookRouter.get('/mustread', requireAuth, (req,res)=>{
  const code = req.session.user.code;
  const nbIds = (store.notebooks[code]||[]).map(n=>n.fromId||n.id);
  res.render('pages/logbook/mustread', { items:store.mustRead, notebooks:nbIds });
});

// --- ARCHIVE
logbookRouter.get('/archive', requireAuth, (req,res)=>{
  const code = req.session.user.code;
  const nbIds = (store.notebooks[code]||[]).map(n=>n.fromId||n.id);
  res.render('pages/logbook/archive', { items:store.archive, notebooks:nbIds });
});

// --- TODO
logbookRouter.get('/todo', requireAuth, (req,res)=>{
  res.render('pages/logbook/todo', { items:store.todos });
});

// --- MY NOTEBOOK
logbookRouter.get('/mynotebook', requireAuth, (req,res)=>{
  const code = req.session.user.code;
  res.render('pages/logbook/mynotebook', { items:store.notebooks[code]||[] });
});

// --- DELETE ÉÉN MESSAGE
logbookRouter.post('/message/:id/delete', requireAuth, (req,res)=>{
  const { id } = req.params;

  store.messages = store.messages.filter(m => m.id !== id);
  store.mustRead = store.mustRead.filter(m => m.id !== id);
  store.archive  = store.archive.filter(m => m.id !== id);

  Object.keys(store.notebooks).forEach(code => {
    store.notebooks[code] = (store.notebooks[code] || []).filter(
      n => n.id !== id && n.fromId !== id
    );
  });

  return res.redirect('back');
});

// --- DELETE TODO
logbookRouter.post('/todo/:id/delete', requireAuth, (req,res)=>{
  const { id } = req.params;
  const before = store.todos.length;
  store.todos = store.todos.filter(t=>t.id!==id);
  const removed = before!==store.todos.length;
  res.status(removed?200:404).json({ ok:removed });
});

// --- ADD-NOTEBOOK
logbookRouter.post('/add-notebook', requireAuth, (req,res)=>{
  const { id } = req.body;
  const msg = store.messages.find(m=>m.id===id)
          || store.mustRead.find(m=>m.id===id)
          || store.archive.find(m=>m.id===id);
  if (msg) {
    const norm = (msg.attachments||[]).map(a=>{
      if (!a || !a.href) return null;
      let mime = a.mime || '';
      if (!mime) {
        const ext = path.extname(a.href||'').toLowerCase();
        mime =
          ext==='.png'  ? 'image/png' :
          ext==='.jpg'  ? 'image/jpeg' :
          ext==='.jpeg' ? 'image/jpeg' :
          ext==='.gif'  ? 'image/gif' :
          ext==='.webp' ? 'image/webp' :
          ext==='.pdf'  ? 'application/pdf' :
          'application/octet-stream';
      }
      return {
        name:a.name||path.basename(a.href),
        href:a.href,
        size:a.size||0,
        mime
      };
    }).filter(Boolean);

    const code = req.session.user.code;
    (store.notebooks[code] ||= []).unshift({
      id:`nb-${msg.id}`,
      fromId:msg.id,
      message:msg.message,
      time:msg.time,
      infoLabels:msg.infoLabels||[],
      software:msg.software||[],
      calc:msg.calc||'',
      push:msg.push||'',
      wms:msg.wms||'',
      chemswitch:msg.chemswitch||'',
      qc:msg.qc||'',
      maintenance:msg.maintenance||'',
      chemib:msg.chemib||'',
      bulkob:msg.bulkob||'',
      topicType: msg.topicType || '',
      attachments:norm,
      createdAt: msg.createdAt || null,
      savedAt:new Date()
    });
  }
  res.redirect('back');
});

// --- REMOVE NOTEBOOK ITEM
logbookRouter.post('/remove-notebook', requireAuth, (req,res)=>{
  const { id } = req.body;
  const code = req.session.user.code;
  if (store.notebooks[code]) {
    store.notebooks[code] = store.notebooks[code].filter(
      n => n.id!==id && n.fromId!==id
    );
  }
  res.redirect('back');
});

// --- ACKNOWLEDGE MUST-READ
logbookRouter.post('/acknowledge', requireAuth, (req,res)=>{
  let { ids } = req.body;
  if (!ids) return res.redirect('back');
  if (!Array.isArray(ids)) ids=[ids];
  store.mustRead = store.mustRead.filter(m=>!ids.includes(m.id));
  res.redirect('/logbook/mustread');
});

app.use('/logbook', logbookRouter);

// =============================
// TOPICS STATS  (redirect naar TEAM)
// =============================
const topicsRouter = express.Router();

topicsRouter.get('/stats', requireAuth, (req, res) => {
  // één centraal endpoint voor de logica in team.js
  return res.redirect('/team/topics/stats');
});

app.use('/topics', topicsRouter);

// =============================
// 404
// =============================
app.use((req,res)=>{
  if (!req.session.user) return res.redirect('/login');
  res.status(404).render('pages/placeholder/index',{ title:'Not Found' });
});

// =============================
// START SERVER
// =============================
const PORT = process.env.PORT || 8888;
const server = app.listen(PORT, () =>
  console.log(`FEWR PMS running at http://localhost:${PORT}`)
);
process.on('SIGINT',  ()=> server.close(()=>process.exit(0)));
process.on('SIGTERM', ()=> server.close(()=>process.exit(0)));
