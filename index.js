const express = require('express');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

const db = new sqlite3.Database('./espoir.db');

// TABLES
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS membres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    telephone TEXT,
    quartier TEXT,
    date_inscription DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cotisations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    membre_id INTEGER,
    montant INTEGER NOT NULL,
    date_cotisation DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (membre_id) REFERENCES membres(id)
  )`);
});

// API MEMBRES
app.get('/api/membres', (req, res) => {
  db.all("SELECT * FROM membres ORDER BY id DESC", [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/api/membres', (req, res) => {
  const { nom, telephone, quartier } = req.body;
  db.run(
    "INSERT INTO membres (nom, telephone, quartier) VALUES (?,?,?)",
    [nom, telephone, quartier],
    function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ id: this.lastID, message: 'Membre ajouté !' });
    }
  );
});

// API COTISATIONS
app.get('/api/cotisations', (req, res) => {
  db.all(`SELECT c.*, m.nom FROM cotisations c 
          JOIN membres m ON c.membre_id = m.id 
          ORDER BY c.id DESC`, [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/api/cotisations', (req, res) => {
  const { membre_id, montant } = req.body;
  db.run(
    "INSERT INTO cotisations (membre_id, montant) VALUES (?,?)",
    [membre_id, montant],
    function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ id: this.lastID, message: 'Cotisation ajoutée !' });
    }
  );
});

// API STATS
app.get('/api/stats', (req, res) => {
  db.get(`SELECT 
    (SELECT COUNT(*) FROM membres) as total_membres,
    (SELECT COALESCE(SUM(montant), 0) FROM cotisations) as total_cotisations
  `, [], (err, row) => {
    res.json(row);
  });
});
// API SUPPRIMER MEMBRE
app.delete('/api/membres/:id', (req, res) => {
  const id = req.params.id;
  
  // On supprime d'abord ses cotisations
  db.run("DELETE FROM cotisations WHERE membre_id =?", [id], (err) => {
    if (err) return res.json({ error: err.message });
    
    // Puis on supprime le membre
    db.run("DELETE FROM membres WHERE id =?", [id], function(err) {
      if (err) return res.json({ error: err.message });
      res.json({ message: 'Membre supprimé!' });
    });
  });
});
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`✅ ESPOIR CITOYEN V14 sur port ${PORT}`));
