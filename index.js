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

// CRÉER LA TABLE SI ELLE EXISTE PAS
pool.query(`
  CREATE TABLE IF NOT EXISTS membres (
    id SERIAL PRIMARY KEY,
    nom TEXT NOT NULL,
    telephone TEXT,
    quartier TEXT,
    date_inscription TIMESTAMP DEFAULT NOW()
  )
`);

// 1. LISTER TOUS LES MEMBRES - OBLIGATOIRE SINON TABLEAU VIDE
app.get('/api/membres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM membres ORDER BY id DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. AJOUTER UN MEMBRE
app.post('/api/membres', async (req, res) => {
  try {
    const { nom, telephone, quartier } = req.body;
    await pool.query(
      'INSERT INTO membres (nom, telephone, quartier) VALUES ($1, $2, $3)',
      [nom, telephone, quartier]
    );
    res.json({ message: 'Membre ajouté' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. SUPPRIMER UN MEMBRE
app.delete('/api/membres/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM membres WHERE id = $1', [id]);
    res.json({ message: 'Membre supprimé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. EXPORT EXCEL
app.get('/api/export/membres', async (req, res) => {
  try {
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

    worksheet.addRows(result.rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=membres_espoir_citoyen.xlsx');

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT}`));
