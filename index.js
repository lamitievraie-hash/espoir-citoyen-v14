const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Création auto des tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS membres (
      id SERIAL PRIMARY KEY,
      nom TEXT NOT NULL,
      telephone TEXT NOT NULL,
      quartier TEXT NOT NULL,
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
  console.log('Tables PostgreSQL prêtes');
}

initDB();

// GET membres
app.get('/api/membres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM membres ORDER BY date_inscription DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST membre
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

// DELETE membre - UNE SEULE FOIS
app.delete('/api/membres/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM membres WHERE id = $1', [id]);
    res.json({ message: 'Membre supprimé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// EXPORT EXCEL DES MEMBRES
app.get('/api/export/membres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM membres ORDER BY nom ASC');
    
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Membres ESPOIR CITOYEN');
    
    worksheet.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Nom Complet', key: 'nom', width: 30 },
      { header: 'Téléphone', key: 'telephone', width: 18 },
      { header: 'Quartier', key: 'quartier', width: 25 },
      { header: 'Date Inscription', key: 'date_inscription', width: 20 }
    ];
    
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
    
    result.rows.forEach(membre => {
      worksheet.addRow({
        id: membre.id,
        nom: membre.nom,
        telephone: membre.telephone,
        quartier: membre.quartier,
        date_inscription: new Date(membre.date_inscription).toLocaleDateString('fr-FR')
      });
    });
    
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=Membres_ESPOIR_CITOYEN.xlsx');
    
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erreur export Excel' });
  }
});

// GET cotisations
app.get('/api/cotisations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.id, c.montant, c.date_cotisation, m.nom 
      FROM cotisations c 
      JOIN membres m ON c.membre_id = m.id 
      ORDER BY c.date_cotisation DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST cotisation
app.post('/api/cotisations', async (req, res) => {
  try {
    const { membre_id, montant } = req.body;
    await pool.query(
      'INSERT INTO cotisations (membre_id, montant) VALUES ($1, $2)',
      [membre_id, montant]
    );
    res.json({ message: 'Cotisation enregistrée' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur V14.3 sur port ${PORT}`));
