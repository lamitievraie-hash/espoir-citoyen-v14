const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const session = require('express-session');
const app = express();

app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: process.env.SESSION_SECRET || 'espoir-citoyen-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24h
}));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// INIT DB
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membres (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      telephone TEXT,
      quartier TEXT,
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
}
initDB();

// MIDDLEWARE AUTH
const requireAuth = (req, res, next) => {
  if (req.session.loggedIn) next();
  else res.status(401).json({ error: 'Non autorisé' });
};

// ===== AUTH =====
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === (process.env.ADMIN_PASSWORD || 'admin2026')) {
    req.session.loggedIn = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Mot de passe incorrect' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/check-auth', (req, res) => {
  res.json({ loggedIn:!!req.session.loggedIn });
});

// ===== MEMBRES =====
app.get('/api/membres', requireAuth, async (req, res) => {
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
});

app.post('/api/membres', requireAuth, async (req, res) => {
  const { nom, telephone, quartier } = req.body;
  await pool.query('INSERT INTO membres (nom, telephone, quartier) VALUES ($1, $2, $3)', [nom, telephone, quartier]);
  res.json({ message: 'Membre ajouté' });
});

app.put('/api/membres/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { nom, telephone, quartier } = req.body;
  await pool.query('UPDATE membres SET nom=$1, telephone=$2, quartier=$3 WHERE id=$4', [nom, telephone, quartier, id]);
  res.json({ message: 'Membre modifié' });
});

app.delete('/api/membres/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM membres WHERE id = $1', [id]);
  res.json({ message: 'Membre supprimé' });
});

// ===== COTISATIONS =====
app.get('/api/cotisations', requireAuth, async (req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.montant, c.date_cotisation, m.nom, m.quartier
    FROM cotisations c
    JOIN membres m ON c.membre_id = m.id
    ORDER BY c.date_cotisation DESC
  `);
  res.json(result.rows);
});

app.post('/api/cotisations', requireAuth, async (req, res) => {
  const { membre_id, montant } = req.body;
  await pool.query('INSERT INTO cotisations (membre_id, montant) VALUES ($1, $2)', [membre_id, montant]);
  res.json({ message: 'Cotisation enregistrée' });
});

app.delete('/api/cotisations/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM cotisations WHERE id = $1', [id]);
  res.json({ message: 'Cotisation supprimée' });
});

// ===== STATS & GRAPHIQUE =====
app.get('/api/stats', requireAuth, async (req, res) => {
  const membres = await pool.query('SELECT COUNT(*) FROM membres');
  const cotisations = await pool.query('SELECT COALESCE(SUM(montant), 0) as total FROM cotisations');
  const parQuartier = await pool.query(`
    SELECT m.quartier, COALESCE(SUM(c.montant), 0) as total
    FROM membres m
    LEFT JOIN cotisations c ON m.id = c.membre_id
    GROUP BY m.quartier
    HAVING m.quartier IS NOT NULL AND m.quartier!= ''
  `);
  res.json({
    total_membres: parseInt(membres.rows[0].count),
    total_cotisations: parseInt(cotisations.rows[0].total),
    graphique_quartier: parQuartier.rows
  });
});

// ===== EXPORT EXCEL =====
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
  const result = await pool.query(`
    SELECT c.id, m.nom, m.quartier, c.montant, c.date_cotisation
    FROM cotisations c
    JOIN membres m ON c.membre_id = m.id
    ORDER BY c.date_cotisation DESC
  `);
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
app.listen(PORT, () => console.log(`Serveur V14.5 sur port ${PORT}`));
