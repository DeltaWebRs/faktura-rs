import puppeteer from '@cloudflare/puppeteer';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

function checkAuth(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '');
  return token === env.PASSWORD;
}

function currentYear() {
  return new Date().getFullYear();
}

async function nextInvoiceNumber(db) {
  const year = currentYear();
  const prefix = `INV-${year}-`;
  const result = await db.prepare(
    `SELECT broj FROM fakture WHERE broj LIKE ? ORDER BY broj DESC LIMIT 1`
  ).bind(`${prefix}%`).first();

  if (!result) return `${prefix}001`;
  const last = parseInt(result.broj.split('-')[2], 10);
  return `${prefix}${String(last + 1).padStart(3, '0')}`;
}

const PREDUZETNIK = {
  naziv: 'Vhirty / Damjan Dulović',
  pib: '115739720',
  mb: '68597455',
  adresa: 'Ruže Šulman 39, 23000 Zrenjanin, Srbija',
  email: 'hello@vhirty.com',
  ziro_rsd: '265-2030310001425-48',
  banka: 'Raiffeisen banka',
  iban: 'RS35265100000125019277',
  swift: 'RZBSRSBG',
};

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}.`;
}

function fmtAmount(amount, valuta) {
  const num = parseFloat(amount) || 0;
  if (valuta === 'RSD') {
    return new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num) + ' RSD';
  }
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num) + ' ' + (valuta || 'EUR');
}

function buildInvoiceHtml(f) {
  let stavke = [];
  try { stavke = typeof f.stavke === 'string' ? JSON.parse(f.stavke) : f.stavke; } catch {}

  const isDevizna = f.valuta !== 'RSD';

  const paymentInfo = isDevizna
    ? `<strong>IBAN:</strong> ${PREDUZETNIK.iban}<br><strong>SWIFT:</strong> ${PREDUZETNIK.swift}<br><strong>Banka:</strong> ${PREDUZETNIK.banka}`
    : `<strong>Žiro račun:</strong> ${PREDUZETNIK.ziro_rsd}<br><strong>Banka:</strong> ${PREDUZETNIK.banka}`;

  const stavkeRows = stavke.map((s, i) => `
    <tr>
      <td>${i + 1}.</td>
      <td>${s.naziv}</td>
      <td style="text-align:right">${parseFloat(s.kolicina).toLocaleString('sr-RS')}</td>
      <td>${s.jedinica || 'kom'}</td>
      <td style="text-align:right">${fmtAmount(s.cena, f.valuta)}</td>
      <td style="text-align:right"><strong>${fmtAmount(s.ukupno, f.valuta)}</strong></td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="sr">
<head>
<meta charset="UTF-8">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#1a1a2e;background:#fff;margin:0;padding:0;width:794px}
.a4{width:100%;padding:0;box-sizing:border-box}
.inv-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:36px}
.inv-company h2{font-size:16px;font-weight:700;color:#2563eb}
.inv-company p{font-size:10px;color:#555;line-height:1.6;margin-top:3px}
.inv-title{text-align:right}
.inv-title h1{font-size:22px;font-weight:700;letter-spacing:2px;color:#1a1a2e}
.inv-title .inv-number{font-size:11px;color:#6b7280;margin-top:4px}
.inv-title .inv-date{font-size:10px;color:#6b7280;margin-top:2px}
.inv-parties{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-bottom:32px}
.inv-party h4{font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px}
.inv-party p{font-size:10px;line-height:1.7;color:#333}
.inv-party strong{color:#1a1a2e}
table.inv-table{width:100%;border-collapse:collapse;margin-bottom:20px}
.inv-table th{background:#f3f4f6;padding:6px 8px;font-size:9px;font-weight:700;color:#6b7280;text-align:left;border-bottom:2px solid #e0e0e0;text-transform:uppercase}
.inv-table td{padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:10px}
.inv-table tr:last-child td{border-bottom:none}
.inv-totals{display:flex;justify-content:flex-end;margin-bottom:32px}
.inv-totals-box{width:260px}
.total-grand{display:flex;justify-content:space-between;padding:8px 0 0;font-size:13px;font-weight:700;color:#2563eb}
.inv-payment{margin-bottom:20px}
.inv-payment h4{font-size:9px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px}
.inv-payment p{font-size:10px;line-height:1.8;color:#333}
.inv-footer{border-top:1px solid #e0e0e0;padding-top:14px;margin-top:auto}
.inv-footer p{font-size:9px;color:#6b7280;line-height:1.7}
</style>
</head>
<body>
<div class="a4">
  <div class="inv-header">
    <div class="inv-company">
      <h2>${PREDUZETNIK.naziv}</h2>
      <p>PIB: ${PREDUZETNIK.pib} &nbsp;|&nbsp; MB: ${PREDUZETNIK.mb}<br>${PREDUZETNIK.adresa}<br>${PREDUZETNIK.email}</p>
    </div>
    <div class="inv-title">
      <h1>FAKTURA</h1>
      <div class="inv-number">Broj: <strong>${f.broj}</strong></div>
      <div class="inv-date">Datum izdavanja: ${fmtDate(f.datum_izdavanja)}</div>
      <div class="inv-date">Datum prometa: ${fmtDate(f.datum_prometa)}</div>
      <div class="inv-date">Rok plaćanja: ${fmtDate(f.datum_valute)}</div>
    </div>
  </div>

  <div class="inv-parties">
    <div class="inv-party">
      <h4>Izdavalac</h4>
      <p><strong>${PREDUZETNIK.naziv}</strong><br>PIB: ${PREDUZETNIK.pib}<br>MB: ${PREDUZETNIK.mb}<br>${PREDUZETNIK.adresa}<br>${PREDUZETNIK.email}</p>
    </div>
    <div class="inv-party">
      <h4>Primalac</h4>
      <p><strong>${f.klijent_naziv || '—'}</strong><br>
      ${f.klijent_pib ? `PIB: ${f.klijent_pib}<br>` : ''}
      ${f.klijent_mb ? `MB: ${f.klijent_mb}<br>` : ''}
      ${f.klijent_adresa ? `${f.klijent_adresa}<br>` : ''}
      ${f.klijent_email ? f.klijent_email : ''}</p>
    </div>
  </div>

  <table class="inv-table">
    <thead>
      <tr>
        <th>R.br.</th>
        <th>Naziv usluge / proizvoda</th>
        <th style="text-align:right">Količina</th>
        <th>Jed. mere</th>
        <th style="text-align:right">Cijena</th>
        <th style="text-align:right">Iznos</th>
      </tr>
    </thead>
    <tbody>${stavkeRows}</tbody>
  </table>

  <div class="inv-totals">
    <div class="inv-totals-box">
      <div class="total-grand">
        <span>UKUPNO ZA PLAĆANJE</span>
        <span>${fmtAmount(f.ukupno, f.valuta)}</span>
      </div>
    </div>
  </div>

  <div class="inv-payment">
    <h4>Podaci za plaćanje</h4>
    <p>${paymentInfo}</p>
  </div>

  ${f.napomena ? `<div class="inv-payment"><h4>Napomena</h4><p>${f.napomena}</p></div>` : ''}

  <div class="inv-footer">
    <p>PDV nije obračunat na osnovu člana 33. Zakona o PDV (paušalni poreski obveznik).</p>
  </div>
</div>
</body>
</html>`;
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Auth endpoint
  if (path === '/api/auth' && method === 'POST') {
    const body = await request.json();
    if (body.password === env.PASSWORD) {
      return json({ token: env.PASSWORD });
    }
    return err('Pogrešna lozinka', 401);
  }

  // All other endpoints require auth
  if (!checkAuth(request, env)) {
    return err('Neautorizovano', 401);
  }

  // === KLIJENTI ===

  if (path === '/api/klijenti' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT * FROM klijenti ORDER BY naziv ASC'
    ).all();
    return json(results);
  }

  if (path === '/api/klijenti' && method === 'POST') {
    const b = await request.json();
    if (!b.naziv) return err('Naziv je obavezan');
    const result = await env.DB.prepare(
      `INSERT INTO klijenti (naziv, pib, mb, adresa, email, drzava, valuta)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(b.naziv, b.pib || null, b.mb || null, b.adresa || null, b.email || null,
      b.drzava || 'Srbija', b.valuta || 'RSD').run();
    const novo = await env.DB.prepare('SELECT * FROM klijenti WHERE id = ?')
      .bind(result.meta.last_row_id).first();
    return json(novo, 201);
  }

  const klijentMatch = path.match(/^\/api\/klijenti\/(\d+)$/);
  if (klijentMatch) {
    const id = klijentMatch[1];
    if (method === 'PUT') {
      const b = await request.json();
      await env.DB.prepare(
        `UPDATE klijenti SET naziv=?, pib=?, mb=?, adresa=?, email=?, drzava=?, valuta=?
         WHERE id=?`
      ).bind(b.naziv, b.pib || null, b.mb || null, b.adresa || null, b.email || null,
        b.drzava || 'Srbija', b.valuta || 'RSD', id).run();
      const updated = await env.DB.prepare('SELECT * FROM klijenti WHERE id = ?').bind(id).first();
      return json(updated);
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM klijenti WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
  }

  // === FAKTURE ===

  if (path === '/api/fakture' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT f.*, k.naziv as klijent_naziv, k.adresa as klijent_adresa,
              k.pib as klijent_pib, k.mb as klijent_mb, k.email as klijent_email,
              k.drzava as klijent_drzava
       FROM fakture f
       LEFT JOIN klijenti k ON f.klijent_id = k.id
       ORDER BY f.created_at DESC`
    ).all();
    return json(results);
  }

  if (path === '/api/fakture' && method === 'POST') {
    const b = await request.json();
    if (!b.klijent_id) return err('Klijent je obavezan');
    if (!b.stavke || !b.stavke.length) return err('Stavke su obavezne');
    if (!b.ukupno) return err('Ukupno je obavezno');

    const broj = await nextInvoiceNumber(env.DB);
    const datumIzdavanja = b.datum_izdavanja || new Date().toISOString().slice(0, 10);
    const datumValute = b.datum_valute || (() => {
      const d = new Date(datumIzdavanja);
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    })();

    const result = await env.DB.prepare(
      `INSERT INTO fakture (broj, klijent_id, stavke, valuta, ukupno, datum_izdavanja, datum_valute, datum_prometa, status, napomena)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      broj, b.klijent_id, JSON.stringify(b.stavke), b.valuta || 'RSD',
      b.ukupno, datumIzdavanja, datumValute, b.datum_prometa || datumIzdavanja,
      'neplacena', b.napomena || null
    ).run();

    const nova = await env.DB.prepare(
      `SELECT f.*, k.naziv as klijent_naziv FROM fakture f
       LEFT JOIN klijenti k ON f.klijent_id = k.id
       WHERE f.id = ?`
    ).bind(result.meta.last_row_id).first();
    return json(nova, 201);
  }

  const fakturaIdMatch = path.match(/^\/api\/fakture\/(\d+)$/);
  if (fakturaIdMatch) {
    const id = fakturaIdMatch[1];
    if (method === 'GET') {
      const faktura = await env.DB.prepare(
        `SELECT f.*, k.naziv as klijent_naziv, k.adresa as klijent_adresa,
                k.pib as klijent_pib, k.mb as klijent_mb, k.email as klijent_email,
                k.drzava as klijent_drzava
         FROM fakture f
         LEFT JOIN klijenti k ON f.klijent_id = k.id
         WHERE f.id = ?`
      ).bind(id).first();
      if (!faktura) return err('Faktura nije pronađena', 404);
      return json(faktura);
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM fakture WHERE id = ?').bind(id).run();
      return json({ success: true });
    }
  }

  const statusMatch = path.match(/^\/api\/fakture\/(\d+)\/status$/);
  if (statusMatch && method === 'PUT') {
    const id = statusMatch[1];
    const b = await request.json();
    if (!['neplacena', 'placena', 'otkazana'].includes(b.status)) {
      return err('Nevalidan status');
    }
    await env.DB.prepare('UPDATE fakture SET status=? WHERE id=?').bind(b.status, id).run();
    const updated = await env.DB.prepare('SELECT * FROM fakture WHERE id=?').bind(id).first();
    return json(updated);
  }

  // === PDF ===

  const pdfMatch = path.match(/^\/api\/fakture\/(\d+)\/pdf$/);
  if (pdfMatch && method === 'GET') {
    const id = pdfMatch[1];
    const faktura = await env.DB.prepare(
      `SELECT f.*, k.naziv as klijent_naziv, k.adresa as klijent_adresa,
              k.pib as klijent_pib, k.mb as klijent_mb, k.email as klijent_email,
              k.drzava as klijent_drzava
       FROM fakture f
       LEFT JOIN klijenti k ON f.klijent_id = k.id
       WHERE f.id = ?`
    ).bind(id).first();
    if (!faktura) return err('Faktura nije pronađena', 404);

    const html = buildInvoiceHtml(faktura);
    const browser = await puppeteer.launch(env.BROWSER);
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });
      await page.emulateMediaType('print');
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '15mm', bottom: '15mm', left: '15mm' },
      });
      return new Response(pdf, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${faktura.broj}.pdf"`,
        },
      });
    } finally {
      await browser.close();
    }
  }

  // === KPO ===

  if (path === '/api/kpo' && method === 'GET') {
    const od = url.searchParams.get('od');
    const do_ = url.searchParams.get('do');
    if (!od || !do_) return err('Od i Do datumi su obavezni');

    const { results } = await env.DB.prepare(
      `SELECT f.id, f.broj, f.datum_izdavanja, f.ukupno, f.valuta, f.status,
              k.naziv as klijent_naziv
       FROM fakture f
       LEFT JOIN klijenti k ON f.klijent_id = k.id
       WHERE f.datum_izdavanja >= ? AND f.datum_izdavanja <= ?
         AND f.status != 'otkazana'
       ORDER BY f.datum_izdavanja ASC`
    ).bind(od, do_).all();
    return json(results);
  }

  return err('Not found', 404);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: 'Server greška', details: e.message }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }
  },
};
