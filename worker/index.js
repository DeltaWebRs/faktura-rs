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

  const pageWidth = 595;
  const pageHeight = Math.max(600, 200 + stavke.length * 25 + 350);

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const black    = rgb(0,     0,     0);
  const darkGray = rgb(0.2,   0.2,   0.2);
  const medGray  = rgb(0.4,   0.4,   0.4);
  const lineGray = rgb(0.8,   0.8,   0.8);
  const darkBg   = rgb(0.133, 0.133, 0.133);
  const gold     = rgb(0.831, 0.686, 0.216);
  const white    = rgb(1,     1,     1);
  const altRow   = rgb(0.976, 0.976, 0.976);

  const margin = 40;
  const cw = pageWidth - margin * 2;

  function fmtDate(d) {
    if (!d) return '-';
    const [yr, mo, dy] = String(d).slice(0, 10).split('-');
    return `${dy}.${mo}.${yr}.`;
  }

  function fmtAmount(amount) {
    const num = parseFloat(amount) || 0;
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' ' + (f.valuta || 'RSD');
  }

  // ── 1. HEADER ────────────────────────────────────────────────────────────
  // Vhirty logo: V-chevron shape, normalised to (0,0)-(380,365)
  // pdf-lib negates SVG Y: y param places SVG y=0 (top of shape) in PDF space
  const logoPath = 'M0,0 L105,0 L190,310 L275,0 L380,0 L218,330 Q190,365 162,330 Z';
  const logoScale = 28 / 365;
  const logoW    = 380 * logoScale;   // ~29pt
  const logoTopY = pageHeight - 22;   // SVG y=0 placed here → logo top in PDF

  page.drawSvgPath(logoPath, { x: margin, y: logoTopY, scale: logoScale, color: gold });

  page.drawText('Vhirty', {
    x: margin + logoW + 6, y: logoTopY - 10,
    font: fontBold, size: 13, color: black,
  });
  page.drawText('Damjan Dulovic', {
    x: margin + logoW + 6, y: logoTopY - 22,
    font, size: 8, color: medGray,
  });

  const invoiceW = fontBold.widthOfTextAtSize('INVOICE', 28);
  page.drawText('INVOICE', {
    x: pageWidth - margin - invoiceW, y: logoTopY - 12,
    font: fontBold, size: 28, color: darkGray,
  });

  // ── 2. DARK TOP BAR ───────────────────────────────────────────────────────
  const barH     = 8;
  const topBarY  = pageHeight - 68;
  page.drawRectangle({ x: 0, y: topBarY, width: pageWidth, height: barH, color: darkBg });

  // ── 3. INVOICE TO section ─────────────────────────────────────────────────
  let y = topBarY - 25;
  const rightColX = pageWidth / 2 + 30;

  page.drawText('INVOICE TO:', { x: margin, y, font: fontBold, size: 8, color: medGray });
  page.drawText(`Invoice No: ${f.broj}`, { x: rightColX, y, font: fontBold, size: 9, color: darkGray });

  y -= 16;
  page.drawText(f.klijent_naziv || '-', { x: margin, y, font: fontBold, size: 11, color: black });
  page.drawText(`Date: ${fmtDate(f.datum_izdavanja)}`, { x: rightColX, y, font, size: 9, color: darkGray });

  y -= 14;
  if (f.klijent_email) {
    page.drawText(f.klijent_email, { x: margin, y, font, size: 9, color: darkGray });
    y -= 12;
  }
  if (f.klijent_adresa) {
    page.drawText(String(f.klijent_adresa).slice(0, 55), { x: margin, y, font, size: 9, color: darkGray });
    y -= 12;
  }

  y -= 18;

  // ── 4. TABLE ──────────────────────────────────────────────────────────────
  const tableHeaderH = 20;
  const rowH         = 22;

  const c0 = margin + 4;
  const c1 = margin + cw * 0.50;
  const c2 = margin + cw * 0.61;
  const c3 = margin + cw * 0.73;
  const c4 = margin + cw * 0.86;

  page.drawRectangle({ x: margin, y: y - tableHeaderH, width: cw, height: tableHeaderH, color: darkBg });

  const thY = y - 14;
  page.drawText('PRODUCT',   { x: c0, y: thY, font: fontBold, size: 8, color: white });
  page.drawText('QTY',       { x: c1, y: thY, font: fontBold, size: 8, color: white });
  page.drawText('JED. MERE', { x: c2, y: thY, font: fontBold, size: 8, color: white });
  page.drawText('PRICE',     { x: c3, y: thY, font: fontBold, size: 8, color: white });
  page.drawText('TOTAL',     { x: c4, y: thY, font: fontBold, size: 8, color: white });

  y -= tableHeaderH;

  stavke.forEach((s, idx) => {
    const rowTopY    = y - idx * rowH;
    const rowBottomY = rowTopY - rowH;
    const textY      = rowBottomY + 7;

    if (idx % 2 === 1) {
      page.drawRectangle({ x: margin, y: rowBottomY, width: cw, height: rowH, color: altRow });
    }
    page.drawLine({
      start: { x: margin, y: rowBottomY }, end: { x: margin + cw, y: rowBottomY },
      thickness: 0.5, color: lineGray,
    });

    page.drawText(String(s.naziv  || '').slice(0, 42), { x: c0, y: textY, font,     size: 9, color: darkGray });
    page.drawText(String(s.kolicina || ''),             { x: c1, y: textY, font,     size: 9, color: darkGray });
    page.drawText(s.jedinica || 'kom',                  { x: c2, y: textY, font,     size: 9, color: darkGray });
    page.drawText(fmtAmount(s.cena),                    { x: c3, y: textY, font,     size: 9, color: darkGray });
    page.drawText(fmtAmount(s.ukupno),                  { x: c4, y: textY, font: fontBold, size: 9, color: darkGray });
  });

  y -= stavke.length * rowH;

  // ── 5. SUBTOTAL ───────────────────────────────────────────────────────────
  y -= 20;
  const subtotalLabelX = margin + cw * 0.58;
  const subtotalValueX = margin + cw * 0.78;

  page.drawLine({
    start: { x: subtotalLabelX, y: y + 18 }, end: { x: margin + cw, y: y + 18 },
    thickness: 0.5, color: lineGray,
  });
  page.drawText('Ukupno:', { x: subtotalLabelX, y, font: fontBold, size: 10, color: darkGray });
  page.drawText(fmtAmount(f.ukupno), { x: subtotalValueX, y, font: fontBold, size: 10, color: black });

  y -= 35;

  // ── 6. PAYMENT INFORMATION ────────────────────────────────────────────────
  page.drawText('Payment Information:', { x: margin, y, font: fontBold, size: 10, color: darkGray });
  y -= 15;

  const isDevizna = f.valuta !== 'RSD';
  if (isDevizna) {
    page.drawText('IBAN: RS35265100000125019277', { x: margin, y, font, size: 9, color: darkGray });
    y -= 12;
    page.drawText('SWIFT: RZBSRSBG', { x: margin, y, font, size: 9, color: darkGray });
    y -= 12;
    page.drawText('Banka: Raiffeisen banka', { x: margin, y, font, size: 9, color: darkGray });
  } else {
    page.drawText('Ziro racun: 265-2030310001425-48', { x: margin, y, font, size: 9, color: darkGray });
    y -= 12;
    page.drawText('Banka: Raiffeisen banka', { x: margin, y, font, size: 9, color: darkGray });
  }

  y -= 25;

  // ── 7. "Hvala na poverenju!" ──────────────────────────────────────────────
  page.drawText('Hvala na poverenju!', { x: margin, y, font: fontBold, size: 11, color: darkGray });

  // ── 8. DARK FOOTER BAR ────────────────────────────────────────────────────
  const footerBarY = 48;
  page.drawRectangle({ x: 0, y: footerBarY, width: pageWidth, height: barH, color: darkBg });

  // ── 9. FOOTER TEXT ────────────────────────────────────────────────────────
  const footerText = 'Ruze Sulman 39, 23000 Zrenjanin  |  hello@vhirty.com  |  vhirty.com';
  const ftW = font.widthOfTextAtSize(footerText, 8);
  page.drawText(footerText, {
    x: (pageWidth - ftW) / 2, y: footerBarY - 14,
    font, size: 8, color: medGray,
  });

  // ── 10. PDV NAPOMENA ──────────────────────────────────────────────────────
  const pdvText = 'PDV nije obracunat na osnovu clana 33. Zakona o PDV (pausalni poreski obveznik).';
  const pdvW = font.widthOfTextAtSize(pdvText, 7);
  page.drawText(pdvText, {
    x: (pageWidth - pdvW) / 2, y: footerBarY - 27,
    font, size: 7, color: lineGray,
  });

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

    const pdfBytes = await buildPdf(faktura);
    return new Response(pdfBytes, {
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
