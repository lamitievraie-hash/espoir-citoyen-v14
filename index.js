const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
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

// DELETE membre
app.delete('/api/membres/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM membres WHERE id = $1', [id]);
    res.json({ message: 'Membre supprimé' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// GET stats
app.get('/api/stats', async (req, res) => {
  try {
    const membres = await pool.query('SELECT COUNT(*) FROM membres');
    const cotisations = await pool.query('SELECT COALESCE(SUM(montant), 0) as total FROM cotisations');
    res.json({
      total_membres: parseInt(membres.rows[0].count),
      total_cotisations: parseInt(cotisations.rows[0].total)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur V14.2 Postgres sur port ${PORT}`));
