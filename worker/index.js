import PdfPrinter from 'pdfmake';

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

const fonts = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique'
  }
};

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}.${m}.${y}.`;
}

function fmtAmount(amount, valuta) {
  const num = parseFloat(amount) || 0;
  return new Intl.NumberFormat('sr-RS', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num) + ' ' + (valuta || 'RSD');
}

function buildPdfDefinition(f) {
  let stavke = [];
  try { stavke = typeof f.stavke === 'string' ? JSON.parse(f.stavke) : f.stavke; } catch {}

  const isDevizna = f.valuta !== 'RSD';

  const tableBody = [
    [
      { text: 'R.br.', style: 'tableHeader' },
      { text: 'Naziv usluge / proizvoda', style: 'tableHeader' },
      { text: 'Kol.', style: 'tableHeader', alignment: 'right' },
      { text: 'Jed.', style: 'tableHeader' },
      { text: 'Cijena', style: 'tableHeader', alignment: 'right' },
      { text: 'Iznos', style: 'tableHeader', alignment: 'right' }
    ],
    ...stavke.map((s, i) => [
      { text: `${i + 1}.`, fontSize: 9 },
      { text: s.naziv, fontSize: 9 },
      { text: String(s.kolicina), fontSize: 9, alignment: 'right' },
      { text: s.jedinica || 'kom', fontSize: 9 },
      { text: fmtAmount(s.cena, f.valuta), fontSize: 9, alignment: 'right' },
      { text: fmtAmount(s.ukupno, f.valuta), fontSize: 9, bold: true, alignment: 'right' }
    ])
  ];

  const paymentInfo = isDevizna
    ? `IBAN: ${PREDUZETNIK.iban}\nSWIFT: ${PREDUZETNIK.swift}\nBanka: ${PREDUZETNIK.banka}`
    : `Žiro račun: ${PREDUZETNIK.ziro_rsd}\nBanka: ${PREDUZETNIK.banka}`;

  return {
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 40],
    defaultStyle: { font: 'Helvetica', fontSize: 10, color: '#1a1a2e' },
    styles: {
      companyName: { fontSize: 16, bold: true, color: '#2563eb' },
      invoiceTitle: { fontSize: 22, bold: true },
      tableHeader: { fontSize: 9, bold: true, color: '#666666', fillColor: '#f3f4f6' },
      sectionLabel: { fontSize: 8, bold: true, color: '#888888' },
      totalLabel: { fontSize: 12, bold: true, color: '#2563eb' },
      footer: { fontSize: 9, color: '#888888' }
    },
    content: [
      {
        columns: [
          {
            stack: [
              { text: PREDUZETNIK.naziv, style: 'companyName' },
              { text: `PIB: ${PREDUZETNIK.pib} | MB: ${PREDUZETNIK.mb}`, fontSize: 9, color: '#555555', margin: [0, 4, 0, 0] },
              { text: PREDUZETNIK.adresa, fontSize: 9, color: '#555555' },
              { text: PREDUZETNIK.email, fontSize: 9, color: '#555555' }
            ]
          },
          {
            stack: [
              { text: 'FAKTURA', style: 'invoiceTitle', alignment: 'right' },
              { text: `Broj: ${f.broj}`, fontSize: 10, alignment: 'right', margin: [0, 4, 0, 0] },
              { text: `Datum izdavanja: ${fmtDate(f.datum_izdavanja)}`, fontSize: 9, color: '#555555', alignment: 'right' },
              { text: `Datum prometa: ${fmtDate(f.datum_prometa)}`, fontSize: 9, color: '#555555', alignment: 'right' },
              { text: `Rok plaćanja: ${fmtDate(f.datum_valute)}`, fontSize: 9, color: '#555555', alignment: 'right' }
            ]
          }
        ],
        margin: [0, 0, 0, 16]
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e0e0e0' }], margin: [0, 0, 0, 16] },
      {
        columns: [
          {
            stack: [
              { text: 'IZDAVALAC', style: 'sectionLabel', margin: [0, 0, 0, 4] },
              { text: PREDUZETNIK.naziv, bold: true, fontSize: 10 },
              { text: `PIB: ${PREDUZETNIK.pib}`, fontSize: 9 },
              { text: `MB: ${PREDUZETNIK.mb}`, fontSize: 9 },
              { text: PREDUZETNIK.adresa, fontSize: 9 },
              { text: PREDUZETNIK.email, fontSize: 9 }
            ]
          },
          {
            stack: [
              { text: 'PRIMALAC', style: 'sectionLabel', margin: [0, 0, 0, 4] },
              { text: f.klijent_naziv || '—', bold: true, fontSize: 10 },
              ...(f.klijent_pib ? [{ text: `PIB: ${f.klijent_pib}`, fontSize: 9 }] : []),
              ...(f.klijent_mb ? [{ text: `MB: ${f.klijent_mb}`, fontSize: 9 }] : []),
              ...(f.klijent_adresa ? [{ text: f.klijent_adresa, fontSize: 9 }] : []),
              ...(f.klijent_email ? [{ text: f.klijent_email, fontSize: 9 }] : [])
            ]
          }
        ],
        margin: [0, 0, 0, 20]
      },
      {
        table: {
          headerRows: 1,
          widths: [30, '*', 35, 35, 80, 80],
          body: tableBody
        },
        layout: {
          hLineWidth: (i) => i === 0 || i === 1 ? 1 : 0.5,
          vLineWidth: () => 0,
          hLineColor: (i) => i === 1 ? '#cccccc' : '#e0e0e0',
          fillColor: (i) => i === 0 ? '#f3f4f6' : null
        },
        margin: [0, 0, 0, 16]
      },
      {
        columns: [
          { text: '', width: '*' },
          {
            stack: [
              { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 1.5, lineColor: '#2563eb' }] },
              {
                columns: [
                  { text: 'UKUPNO ZA PLAĆANJE', style: 'totalLabel', margin: [0, 6, 0, 0] },
                  { text: fmtAmount(f.ukupno, f.valuta), style: 'totalLabel', alignment: 'right', margin: [0, 6, 0, 0] }
                ]
              }
            ],
            width: 200
          }
        ],
        margin: [0, 0, 0, 20]
      },
      { text: 'PODACI ZA PLAĆANJE', style: 'sectionLabel', margin: [0, 0, 0, 4] },
      { text: paymentInfo, fontSize: 10 },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e0e0e0' }], margin: [0, 16, 0, 8] },
      { text: 'PDV nije obračunat na osnovu člana 33. Zakona o PDV (paušalni poreski obveznik).', style: 'footer' }
    ]
  };
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

    const printer = new PdfPrinter(fonts);
    const docDefinition = buildPdfDefinition(faktura);
    const pdfDoc = printer.createPdfKitDocument(docDefinition);
    const chunks = [];
    pdfDoc.on('data', chunk => chunks.push(chunk));
    await new Promise(resolve => pdfDoc.on('end', resolve));
    pdfDoc.end();
    const pdfBuffer = Buffer.concat(chunks);
    return new Response(pdfBuffer, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${faktura.broj}.pdf"`,
      }
    });
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
