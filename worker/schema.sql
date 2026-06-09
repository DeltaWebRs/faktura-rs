CREATE TABLE IF NOT EXISTS klijenti (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  naziv TEXT NOT NULL,
  pib TEXT,
  mb TEXT,
  adresa TEXT,
  email TEXT,
  drzava TEXT DEFAULT 'Srbija',
  valuta TEXT DEFAULT 'RSD',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fakture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  broj TEXT UNIQUE,
  klijent_id INTEGER REFERENCES klijenti(id),
  stavke TEXT,
  valuta TEXT DEFAULT 'RSD',
  ukupno REAL NOT NULL,
  datum_izdavanja DATE,
  datum_valute DATE,
  datum_prometa DATE,
  status TEXT DEFAULT 'neplacena',
  napomena TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
