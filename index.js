const express = require('express');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CRÉER LES TABLES
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

// ===== ROUTES MEMBRES =====
app.get('/api/membres', async (req, res) => {
  const result = await pool.query('SELECT * FROM membres ORDER BY id DESC');
  res.json(result.rows);
});

app.post('/api/membres', async (req, res) => {
  const { nom, telephone, quartier } = req.body;
  await pool.query('INSERT INTO membres (nom, telephone, quartier) VALUES ($1, $2, $3)', [nom, telephone, quartier]);
  res.json({ message: 'Membre ajouté' });
});

app.put('/api/membres/:id', async (req, res) => {
  const { id } = req.params;
  const { nom, telephone, quartier } = req.body;
  await pool.query('UPDATE membres SET nom=$1, telephone=$2, quartier=$3 WHERE id=$4', [nom, telephone, quartier, id]);
  res.json({ message: 'Membre modifié' });
});

app.delete('/api/membres/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM membres WHERE id = $1', [id]);
  res.json({ message: 'Membre supprimé' });
});

// ===== ROUTES COTISATIONS =====
app.get('/api/cotisations', async (req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.montant, c.date_cotisation, m.nom
    FROM cotisations c
    JOIN membres m ON c.membre_id = m.id
    ORDER BY c.date_cotisation DESC
  `);
  res.json(result.rows);
});

app.post('/api/cotisations', async (req, res) => {
  const { membre_id, montant } = req.body;
  await pool.query('INSERT INTO cotisations (membre_id, montant) VALUES ($1, $2)', [membre_id, montant]);
  res.json({ message: 'Cotisation enregistrée' });
});

app.delete('/api/cotisations/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM cotisations WHERE id = $1', [id]);
  res.json({ message: 'Cotisation supprimée' });
});

// ===== ROUTE STATS =====
app.get('/api/stats', async (req, res) => {
  const membres = await pool.query('SELECT COUNT(*) FROM membres');
  const cotisations = await pool.query('SELECT COALESCE(SUM(montant), 0) as total FROM cotisations');
  res.json({
    total_membres: parseInt(membres.rows[0].count),
    total_cotisations: parseInt(cotisations.rows[0].total)
  });
});

// ===== EXPORT EXCEL =====
app.get('/api/export/membres', async (req, res) => {
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

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur V14.4 sur port ${PORT}`));
