# FakturaRS

Sistem za fakturisanje za srpskog paušalnog preduzetnika.

## Stack
- **Frontend**: Vanilla HTML/CSS/JS na Cloudflare Pages
- **Backend**: Cloudflare Worker
- **Baza**: Cloudflare D1

## Setup

### 1. Kreiranje D1 baze

```bash
cd worker
npx wrangler d1 create faktura-rs-db
```

Kopirajte `database_id` i zamijenite `REPLACE_WITH_YOUR_D1_ID` u `wrangler.toml`.

### 2. Pokretanje schema

```bash
npx wrangler d1 execute faktura-rs-db --file=schema.sql
```

### 3. Postavljanje lozinke

```bash
npx wrangler secret put PASSWORD
```

### 4. Deploy workera

```bash
npx wrangler deploy
```

Zapišite URL workera (npr. `https://faktura-rs-worker.XXX.workers.dev`).

### 5. Ažuriranje API_BASE u frontend/api.js

Zamijenite `REPLACE_SUBDOMAIN` sa vašim Cloudflare Workers subdomenom u `frontend/api.js`.

### 6. Deploy frontenda

Deployajte `frontend/` folder na Cloudflare Pages.

## Stranice
- `/login.html` — Prijava
- `/index.html` — Dashboard
- `/klijenti.html` — Upravljanje klijentima
- `/nova-faktura.html` — Kreiranje fakture
- `/faktura.html?id=X` — Pregled i PDF download fakture
- `/kpo.html` — KPO knjiga prometa
