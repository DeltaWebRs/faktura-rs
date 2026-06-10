import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

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

async function buildPdf(f) {
  let stavke = [];
  try { stavke = typeof f.stavke === 'string' ? JSON.parse(f.stavke) : f.stavke; } catch {}

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  let font, fontBold;
  try {
    const [regBytes, boldBytes] = await Promise.all([
      fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Regular.ttf').then(r => r.arrayBuffer()),
      fetch('https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts@main/hinted/ttf/NotoSans/NotoSans-Bold.ttf').then(r => r.arrayBuffer())
    ]);
    font = await pdfDoc.embedFont(regBytes);
    fontBold = await pdfDoc.embedFont(boldBytes);
  } catch(e) {
    font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  }

  function tr(str) {
    if (!str) return '';
    return String(str)
      .replace(/[čć]/g, 'c').replace(/[ČĆ]/g, 'C')
      .replace(/š/g, 's').replace(/Š/g, 'S')
      .replace(/ž/g, 'z').replace(/Ž/g, 'Z')
      .replace(/đ/g, 'dj').replace(/Đ/g, 'Dj');
  }

  const blue = rgb(0.145, 0.388, 0.922);
  const dark = rgb(0.102, 0.102, 0.173);
  const gray = rgb(0.42, 0.44, 0.5);

  function fmtDate(d) {
    if (!d) return '-';
    const [y, m, day] = String(d).slice(0, 10).split('-');
    return `${day}.${m}.${y}.`;
  }

  function fmtAmount(amount, valuta) {
    const num = parseFloat(amount) || 0;
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' ' + (valuta || f.valuta || 'RSD');
  }

  const margin = 40;
  let y = height - 50;

  // Company name
  page.drawText('Vhirty / Damjan Dulović', { x: margin, y, font: fontBold, size: 16, color: blue });

  // FAKTURA title
  page.drawText('FAKTURA', { x: width - margin - 120, y, font: fontBold, size: 22, color: dark });

  y -= 18;
  page.drawText('PIB: 115739720 | MB: 68597455', { x: margin, y, font, size: 9, color: gray });
  page.drawText(`Broj: ${f.broj}`, { x: width - margin - 120, y, font: fontBold, size: 10, color: dark });

  y -= 14;
  page.drawText('Ruže Šulman 39, 23000 Zrenjanin, Srbija', { x: margin, y, font, size: 9, color: gray });
  page.drawText(`Datum: ${fmtDate(f.datum_izdavanja)}`, { x: width - margin - 120, y, font, size: 9, color: gray });

  y -= 14;
  page.drawText('hello@vhirty.com', { x: margin, y, font, size: 9, color: gray });
  page.drawText(`Promet: ${fmtDate(f.datum_prometa)}`, { x: width - margin - 120, y, font, size: 9, color: gray });

  y -= 14;
  page.drawText(`Rok plaćanja: ${fmtDate(f.datum_valute)}`, { x: width - margin - 120, y, font, size: 9, color: gray });

  // Divider
  y -= 20;
  page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });

  // Parties
  y -= 20;
  page.drawText('IZDAVALAC', { x: margin, y, font: fontBold, size: 8, color: gray });
  page.drawText('PRIMALAC', { x: width/2, y, font: fontBold, size: 8, color: gray });

  y -= 16;
  page.drawText('Vhirty / Damjan Dulović', { x: margin, y, font: fontBold, size: 10, color: dark });
  page.drawText(f.klijent_naziv || '-', { x: width/2, y, font: fontBold, size: 10, color: dark });

  const izdLines = ['PIB: 115739720', 'MB: 68597455', 'Ruže Šulman 39, 23000 Zrenjanin', 'hello@vhirty.com'];
  const primLines = [
    f.klijent_pib ? `PIB: ${f.klijent_pib}` : null,
    f.klijent_mb ? `MB: ${f.klijent_mb}` : null,
    f.klijent_adresa || null,
    f.klijent_email || null
  ].filter(Boolean);

  const maxLines = Math.max(izdLines.length, primLines.length);
  for (let i = 0; i < maxLines; i++) {
    y -= 14;
    if (izdLines[i]) page.drawText(izdLines[i], { x: margin, y, font, size: 9, color: dark });
    if (primLines[i]) page.drawText(primLines[i], { x: width/2, y, font, size: 9, color: dark });
  }

  // Table header
  y -= 28;
  page.drawRectangle({ x: margin, y: y - 4, width: width - margin*2, height: 20, color: rgb(0.95, 0.96, 0.97) });
  const cols = [margin, margin+35, margin+220, margin+265, margin+305, margin+400];
  const headers = ['R.br.', 'Naziv usluge / proizvoda', 'Kol.', 'Jed.', 'Cena', 'Iznos'];
  headers.forEach((h, i) => {
    page.drawText(h, { x: cols[i], y, font: fontBold, size: 8, color: gray });
  });

  // Table rows
  stavke.forEach((s, idx) => {
    const naziv = String(s.naziv);
    const twoLines = naziv.length > 40;
    y -= twoLines ? 32 : 22;
    page.drawLine({ start: { x: margin, y: y - 4 }, end: { x: width - margin, y: y - 4 }, thickness: 0.3, color: rgb(0.94, 0.94, 0.94) });
    const rowY = twoLines ? y + 5 : y;
    page.drawText(`${idx + 1}.`, { x: cols[0], y: rowY, font, size: 9, color: dark });
    if (twoLines) {
      page.drawText(naziv.slice(0, 40), { x: cols[1], y: y + 5, font, size: 9, color: dark });
      page.drawText(naziv.slice(40, 80), { x: cols[1], y: y - 6, font, size: 9, color: dark });
    } else {
      page.drawText(naziv.slice(0, 55), { x: cols[1], y, font, size: 9, color: dark });
    }
    page.drawText(String(s.kolicina), { x: cols[2], y: rowY, font, size: 9, color: dark });
    page.drawText(s.jedinica || 'kom', { x: cols[3], y: rowY, font, size: 9, color: dark });
    page.drawText(fmtAmount(s.cena), { x: cols[4], y: rowY, font, size: 9, color: dark });
    page.drawText(fmtAmount(s.ukupno), { x: cols[5], y: rowY, font: fontBold, size: 9, color: dark });
  });

  // Total
  y -= 45;
  const boxX = width - margin - 175;
  const boxY = y - 28;
  page.drawRectangle({ x: boxX, y: boxY, width: 180, height: 58, color: rgb(0.94, 0.97, 1.0) });
  page.drawText('UKUPNO ZA PLAĆANJE', { x: boxX + 10, y: y - 5, font: fontBold, size: 9, color: blue });
  page.drawText(fmtAmount(f.ukupno, f.valuta), { x: boxX + 10, y: y - 22, font: fontBold, size: 13, color: blue });

  // Payment info
  y -= 65;
  page.drawText('PODACI ZA PLAĆANJE', { x: margin, y, font: fontBold, size: 8, color: gray });
  y -= 14;
  const isDevizna = f.valuta !== 'RSD';
  if (isDevizna) {
    page.drawText('IBAN: RS35265100000125019277', { x: margin, y, font, size: 10, color: dark });
    y -= 14;
    page.drawText('SWIFT: RZBSRSBG  |  Banka: Raiffeisen banka', { x: margin, y, font, size: 10, color: dark });
  } else {
    page.drawText('Žiro račun: 265-2030310001425-48  |  Banka: Raiffeisen banka', { x: margin, y, font, size: 10, color: dark });
  }
  y -= 14;
  page.drawText(`Poziv na broj: ${f.broj}`, { x: margin, y, font, size: 9, color: gray });

  // Napomena
  if (f.napomena && String(f.napomena).trim()) {
    y -= 20;
    page.drawText('Napomena:', { x: margin, y, font: fontBold, size: 9, color: gray });
    y -= 14;
    const napLines = String(f.napomena).match(/.{1,90}/g) || [];
    napLines.forEach(line => {
      page.drawText(line, { x: margin, y, font, size: 9, color: dark });
      y -= 14;
    });
  }

  // Footer — fixed at bottom of page
  page.drawLine({ start: { x: margin, y: 50 }, end: { x: width - margin, y: 50 }, thickness: 0.5, color: rgb(0.88, 0.88, 0.88) });
  page.drawText('PDV nije obračunat na osnovu člana 33. Zakona o PDV (paušalni poreski obveznik).', { x: margin, y: 35, font, size: 9, color: gray });

  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
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

    try {
      const pdfBytes = await buildPdf(faktura);
      return new Response(pdfBytes, {
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${faktura.broj}.pdf"`,
        }
      });
    } catch (err) {
      console.error('buildPdf error:', err);
      return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
        status: 500,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
      });
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
