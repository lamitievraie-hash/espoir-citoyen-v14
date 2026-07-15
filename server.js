const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const app = express();

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'espoir-citoyen-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: false, // Render gère le https, mets true si tu as un domaine custom https
    sameSite: 'lax'
  }
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage });

// ===== INIT DB V15.1 FIX =====
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'secretaire',
        nom TEXT,
        date_creation TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS membres (
        id SERIAL PRIMARY KEY,
        nom TEXT NOT NULL,
        telephone TEXT,
        quartier TEXT,
        photo TEXT,
        date_inscription TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cotisations (
        id SERIAL PRIMARY KEY,
        membre_id INTEGER REFERENCES membres(id) ON DELETE CASCADE,
        montant INTEGER NOT NULL,
        date_cotisation TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`ALTER TABLE membres ADD COLUMN IF NOT EXISTS photo TEXT`);

    if (process.env.SUPER_ADMIN_EMAIL) {
      const existe = await pool.query('SELECT * FROM admins WHERE email = $1', [process.env.SUPER_ADMIN_EMAIL]);
      if (existe.rows.length === 0) {
        await pool.query('INSERT INTO admins (email, password, role, nom) VALUES ($1, $2, $3, $4)',
          [process.env.SUPER_ADMIN_EMAIL, process.env.ADMIN_PASSWORD || 'admin2026', 'super_admin', 'Super Admin']);
        console.log("Super Admin créé");
      }
    }
    console.log("DB V15.1 FIX prête");
  } catch(e) {
    console.error("Erreur initDB:", e);
  }
}
initDB();

// ===== MIDDLEWARE AUTH + ROLES =====
const requireAuth = (req, res, next) => {
  if (req.session.loggedIn) next();
  else res.status(401).json({ error: 'Non autorisé - session expirée' });
};

const requireRole = (roles) => (req, res, next) => {
  if (req.session.loggedIn && roles.includes(req.session.role)) next();
  else res.status(403).json({ error: 'Accès refusé pour le rôle ' + req.session.role });
};

// ===== AUTH =====
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query('SELECT * FROM admins WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length > 0) {
      req.session.loggedIn = true;
      req.session.role = result.rows[0].role;
      req.session.admin_id = result.rows[0].id;
      req.session.nom = result.rows[0].nom;
      res.json({ success: true, role: result.rows[0].role, nom: result.rows[0].nom });
    } else {
      res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
  } catch(e){ res.status(500).json({error: e.message}); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(()=>{}); res.json({ success: true }); });
app.get('/api/check-auth', (req, res) => {
  res.json({ loggedIn:!!req.session.loggedIn, role: req.session.role, nom: req.session.nom });
});

// ===== ADMINS =====
app.get('/api/admins', requireAuth, requireRole(['super_admin']), async (req, res) => {
  const result = await pool.query('SELECT id, email, role, nom, date_creation FROM admins ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/admins', requireAuth, requireRole(['super_admin']), async (req, res) => {
  const { email, password, role, nom } = req.body;
  try {
    await pool.query('INSERT INTO admins (email, password, role, nom) VALUES ($1, $2, $3, $4)', [email, password, role, nom]);
    res.json({ message: 'Admin ajouté' });
  } catch (e) {
    res.status(400).json({ error: 'Email déjà utilisé' });
  }
});

app.delete('/api/admins/:id', requireAuth, requireRole(['super_admin']), async (req, res) => {
  await pool.query('DELETE FROM admins WHERE id = $1 AND role!= $2', [req.params.id, 'super_admin']);
  res.json({ message: 'Admin supprimé' });
});

// ===== MEMBRES =====
app.get('/api/membres', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM membres';
    let params = [];
    if (search) {
      query += ' WHERE nom ILIKE $1 OR telephone ILIKE $1 OR quartier ILIKE $1';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY id DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch(e){ res.status(500).json({error: e.message}); }
});

app.post('/api/membres', requireAuth, requireRole(['super_admin', 'secretaire']), upload.single('photo'), async (req, res) => {
  try {
    const { nom, telephone, quartier } = req.body;
    if(!nom) return res.status(400).json({error: 'Nom obligatoire'});
    const photo = req.file? req.file.filename : null;
    await pool.query('INSERT INTO membres (nom, telephone, quartier, photo) VALUES ($1, $2, $3, $4)', [nom, telephone, quartier, photo]);
    res.json({ message: 'Membre ajouté' });
  } catch(e){ res.status(500).json({error: e.message}); }
});

app.put('/api/membres/:id', requireAuth, requireRole(['super_admin', 'secretaire']), upload.single('photo'), async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, telephone, quartier } = req.body;
    const photo = req.file? req.file.filename : req.body.photo_existante || null;
    await pool.query('UPDATE membres SET nom=$1, telephone=$2, quartier=$3, photo=$4 WHERE id=$5', [nom, telephone, quartier, photo, id]);
    res.json({ message: 'Membre modifié' });
  } catch(e){ res.status(500).json({error: e.message}); }
});

app.delete('/api/membres/:id', requireAuth, requireRole(['super_admin']), async (req, res) => {
  try {
    const membre = await pool.query('SELECT photo FROM membres WHERE id = $1', [req.params.id]);
    if (membre.rows[0]?.photo) {
      try { fs.unlinkSync(`uploads/${membre.rows[0].photo}`); } catch(e){}
    }
    await pool.query('DELETE FROM membres WHERE id = $1', [req.params.id]);
    res.json({ message: 'Membre supprimé' });
  } catch(e){ res.status(500).json({error: e.message}); }
});

// ===== CARTE MEMBRE =====
app.get('/api/membre/:id/carte', requireAuth, async (req, res) => {
  try {
    const membre = await pool.query('SELECT * FROM membres WHERE id = $1', [req.params.id]);
    if (membre.rows.length === 0) return res.status(404).send('Membre introuvable');
    const m = membre.rows[0];
    const qrData = `ESPOIR CITOYEN\nID: ${m.id}\nNom: ${m.nom}\nTel: ${m.telephone}\nQuartier: ${m.quartier}`;
    const qrCodeDataURL = await QRCode.toDataURL(qrData, { width: 200 });
    res.json({ membre: m, qrcode: qrCodeDataURL });
  } catch(e){ res.status(500).json({error: e.message}); }
});

// ===== COTISATIONS - FIX PRINCIPAL ICI =====
app.get('/api/cotisations', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.membre_id, c.montant, c.date_cotisation, m.nom, m.quartier, m.telephone
      FROM cotisations c
      JOIN membres m ON c.membre_id = m.id
      ORDER BY c.date_cotisation DESC
    `);
    res.json(result.rows);
  } catch(e){
    console.error("Erreur GET cotisations:", e);
    res.status(500).json({error: e.message});
  }
});

app.post('/api/cotisations', requireAuth, requireRole(['super_admin', 'tresorier', 'secretaire']), async (req, res) => {
  try {
    const { membre_id, montant } = req.body;
    if(!membre_id ||!montant) return res.status(400).json({error: 'Membre et montant obligatoires'});
    await pool.query('INSERT INTO cotisations (membre_id, montant) VALUES ($1, $2)', [membre_id, montant]);
    const membre = await pool.query('SELECT nom, telephone FROM membres WHERE id = $1', [membre_id]);
    res.json({
      message: 'Cotisation enregistrée',
      whatsapp: {
        nom: membre.rows[0]?.nom || 'Membre',
        telephone: membre.rows[0]?.telephone || '',
        montant: montant
      }
    });
  } catch(e){
    console.error("Erreur POST cotisation:", e);
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/cotisations/:id', requireAuth, requireRole(['super_admin', 'tresorier']), async (req, res) => {
  try {
    await pool.query('DELETE FROM cotisations WHERE id = $1', [req.params.id]);
    res.json({ message: 'Cotisation supprimée' });
  } catch(e){ res.status(500).json({error: e.message}); }
});

// ===== STATS =====
app.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const membres = await pool.query('SELECT COUNT(*) FROM membres');
    const cotisations = await pool.query('SELECT COALESCE(SUM(montant), 0) as total FROM cotisations');
    const parQuartier = await pool.query(`
      SELECT m.quartier, COALESCE(SUM(c.montant), 0) as total
      FROM membres m
      LEFT JOIN cotisations c ON m.id = c.membre_id
      GROUP BY m.quartier HAVING m.quartier IS NOT NULL AND m.quartier!= ''
    `);
    const parMois = await pool.query(`
      SELECT TO_CHAR(date_cotisation, 'YYYY-MM') as mois, COALESCE(SUM(montant), 0) as total
      FROM cotisations
      WHERE date_cotisation >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(date_cotisation, 'YYYY-MM')
      ORDER BY mois ASC
    `);
    res.json({
      total_membres: parseInt(membres.rows[0].count),
      total_cotisations: parseInt(cotisations.rows[0].total),
      graphique_quartier: parQuartier.rows,
      graphique_mois: parMois.rows
    });
  } catch(e){ res.status(500).json({error: e.message}); }
});

// ===== EXPORTS =====
app.get('/api/export/pdf-dashboard', requireAuth, async (req, res) => {
  try {
    const stats = await pool.query('SELECT COUNT(*) as total_membres FROM membres');
    const cotisations = await pool.query('SELECT COALESCE(SUM(montant), 0) as total FROM cotisations');
    const parQuartier = await pool.query(`SELECT m.quartier, COALESCE(SUM(c.montant), 0) as total FROM membres m LEFT JOIN cotisations c ON m.id = c.membre_id GROUP BY m.quartier HAVING m.quartier IS NOT NULL AND m.quartier!= ''`);
    const parMois = await pool.query(`SELECT TO_CHAR(date_cotisation, 'Month YYYY') as mois, COALESCE(SUM(montant), 0) as total FROM cotisations WHERE date_cotisation >= NOW() - INTERVAL '6 months' GROUP BY TO_CHAR(date_cotisation, 'Month YYYY'), date_trunc('month', date_cotisation) ORDER BY date_trunc('month', date_cotisation) DESC`);

    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=tableau_bord_espoir_citoyen.pdf');
    doc.pipe(res);
    if (fs.existsSync('public/logo.png')) { doc.image('public/logo.png', 50, 45, { width: 80 }); }
    doc.fontSize(20).fillColor('#003366').text('ONG ESPOIR CITOYEN', 150, 50);
    doc.fontSize(14).fillColor('black').text('Tableau de Bord - ' + new Date().toLocaleDateString('fr-FR'), 150, 75);
    doc.moveDown(2);
    doc.fontSize(16).fillColor('#003366').text('Statistiques Générales', 50, 150);
    doc.fontSize(12).fillColor('black');
    doc.text(`Total Membres: ${stats.rows[0].total_membres}`, 50, 180);
    doc.text(`Total Cotisations: ${parseInt(cotisations.rows[0].total).toLocaleString()} FCFA`, 50, 200);
    doc.text(`Quartiers Actifs: ${parQuartier.rows.length}`, 50, 220);
    doc.moveDown(2);
    doc.fontSize(16).fillColor('#003366').text('Répartition par Quartier', 50, 270);
    doc.fontSize(12).fillColor('black');
    let y = 300;
    parQuartier.rows.forEach(q => { doc.text(`${q.quartier}: ${parseInt(q.total).toLocaleString()} FCFA`, 50, y); y += 20; if (y > 700) { doc.addPage(); y = 50; } });
    y += 20; if (y > 650) { doc.addPage(); y = 50; }
    doc.fontSize(16).fillColor('#003366').text('Cotisations des 6 derniers mois', 50, y); y += 30;
    doc.fontSize(12).fillColor('black');
    parMois.rows.forEach(m => { doc.text(`${m.mois.trim()}: ${parseInt(m.total).toLocaleString()} FCFA`, 50, y); y += 20; });
    doc.fontSize(10).fillColor('grey').text('Document généré automatiquement par ESPOIR CITOYEN V15.1 FIX', 50, 750);
    doc.end();
  } catch(e){ res.status(500).send(e.message); }
});

app.get('/api/export/membres', requireAuth, async (req, res) => {
  const result = await pool.query('SELECT * FROM membres ORDER BY nom ASC');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Membres');
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Nom', key: 'nom', width: 30 },
    { header: 'Téléphone', key: 'telephone', width: 20 },
    { header: 'Quartier', key: 'quartier', width: 25 },
    { header: 'Date Inscription', key: 'date_inscription', width: 20 }
  ];
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003366' } };
  worksheet.addRows(result.rows.map(r => ({...r, date_inscription: new Date(r.date_inscription).toLocaleDateString('fr-FR')})));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=membres_espoir_citoyen.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('/api/export/cotisations', requireAuth, async (req, res) => {
  const result = await pool.query(`SELECT c.id, m.nom, m.quartier, c.montant, c.date_cotisation FROM cotisations c JOIN membres m ON c.membre_id = m.id ORDER BY c.date_cotisation DESC`);
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Cotisations');
  worksheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Membre', key: 'nom', width: 30 },
    { header: 'Quartier', key: 'quartier', width: 25 },
    { header: 'Montant', key: 'montant', width: 15 },
    { header: 'Date', key: 'date_cotisation', width: 20 }
  ];
  worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF003366' } };
  worksheet.addRows(result.rows.map(r => ({...r, date_cotisation: new Date(r.date_cotisation).toLocaleDateString('fr-FR'), montant: r.montant + ' FCFA'})));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=cotisations_espoir_citoyen.xlsx');
  await workbook.xlsx.write(res);
  res.end();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur V15.1 FIX sur port ${PORT}`));
