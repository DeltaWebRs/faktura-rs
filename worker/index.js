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

  const pageHeight = Math.max(500, 280 + stavke.length * 22 + 200);
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, pageHeight]);
  const { width, height } = page.getSize();

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const dark    = rgb(0.047, 0.102, 0.18);
  const gold    = rgb(0.961, 0.651, 0.137);
  const altRow  = rgb(0.973, 0.980, 0.988);
  const gray    = rgb(0.5,   0.52,  0.56);
  const white   = rgb(1,     1,     1);

  const margin  = 40;
  const headerH = 56;
  const footerH = 56;
  const logoPath = 'M60,65 L165,65 L250,375 L335,65 L440,65 L278,395 Q250,430 222,395 Z';
  const svgMidY  = (65 + 430) / 2; // 247.5 — vertical centre of the SVG bounding box

  function fmtDate(d) {
    if (!d) return '-';
    const [yr, m, day] = String(d).slice(0, 10).split('-');
    return `${day}.${m}.${yr}.`;
  }

  function fmtAmount(amount) {
    const num = parseFloat(amount) || 0;
    return num.toLocaleString('de-DE', { minimumFractionDigits: 2 }) + ' ' + (f.valuta || 'RSD');
  }

  // Draws the V glyph (gold) + "hirty" (white) centred at pdfCenterY, logo left edge at pdfLeftX.
  function drawVhirtyLogo(pdfLeftX, pdfCenterY, scale, textSize) {
    page.drawSvgPath(logoPath, {
      x: pdfLeftX - 60 * scale,
      y: pdfCenterY - svgMidY * scale,
      scale,
      color: gold,
    });
    const afterV = pdfLeftX + (440 - 60) * scale;
    page.drawText('hirty', {
      x: afterV + 3,
      y: pdfCenterY - textSize * 0.38,
      font: fontBold, size: textSize, color: white,
    });
    return afterV + 3 + fontBold.widthOfTextAtSize('hirty', textSize);
  }

  // ─── 1. HEADER ───────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: dark });

  drawVhirtyLogo(margin, height - headerH / 2, 24 / 365, 14);

  const fakturaW = fontBold.widthOfTextAtSize('FAKTURA', 16);
  page.drawText('FAKTURA', {
    x: width - margin - fakturaW,
    y: height - headerH / 2 - 6,
    font: fontBold, size: 16, color: white,
  });

  // ─── 2. DATA SECTION ─────────────────────────────────────────────────────────
  let y = height - headerH - 24;

  // Right column — right-aligned invoice meta
  const rightItems = [
    { label: `Invoice No: ${f.broj}`,                       color: gray },
    { label: `Datum: ${fmtDate(f.datum_izdavanja)}`,        color: dark },
    { label: `Rok placanja: ${fmtDate(f.datum_valute)}`,    color: dark },
  ];
  let rightY = y;
  for (const item of rightItems) {
    const w = font.widthOfTextAtSize(item.label, 9);
    page.drawText(item.label, { x: width - margin - w, y: rightY, font, size: 9, color: item.color });
    rightY -= 14;
  }

  // Left column — client details
  page.drawText('INVOICE TO', { x: margin, y, font: fontBold, size: 8, color: gray });
  let leftY = y - 14;
  page.drawText(f.klijent_naziv || '-', { x: margin, y: leftY, font: fontBold, size: 11, color: dark });
  leftY -= 13;

  const clientLines = [
    f.klijent_pib   ? `PIB: ${f.klijent_pib}`   : null,
    f.klijent_mb    ? `MB: ${f.klijent_mb}`      : null,
    f.klijent_adresa || null,
    f.klijent_email  || null,
  ].filter(Boolean);

  for (const line of clientLines) {
    page.drawText(line, { x: margin, y: leftY, font, size: 9, color: dark });
    leftY -= 13;
  }

  y = Math.min(leftY, rightY) - 14;

  // ─── 3. TABLE ────────────────────────────────────────────────────────────────
  const tableW = width - margin * 2;
  const rowH   = 22;
  const cols   = [margin, margin+30, margin+240, margin+278, margin+318, margin+428];
  const hdrLabels = ['R.br.', 'Naziv usluge / proizvoda', 'Kol.', 'Jed.', 'Cijena', 'Iznos'];

  // Header row
  page.drawRectangle({ x: margin, y: y - 6, width: tableW, height: rowH, color: dark });
  hdrLabels.forEach((h, i) => {
    page.drawText(h, { x: cols[i] + 3, y: y + 4, font: fontBold, size: 8, color: gold });
  });
  y -= rowH;

  // Data rows
  stavke.forEach((s, idx) => {
    if (idx % 2 === 0) {
      page.drawRectangle({ x: margin, y: y - 6, width: tableW, height: rowH, color: altRow });
    }
    const cy = y + 4;
    page.drawText(`${idx + 1}.`,                          { x: cols[0]+3, y: cy, font,     size: 9, color: dark });
    page.drawText(String(s.naziv || '').slice(0, 40),     { x: cols[1]+3, y: cy, font,     size: 9, color: dark });
    page.drawText(String(s.kolicina || ''),                { x: cols[2]+3, y: cy, font,     size: 9, color: dark });
    page.drawText(String(s.jedinica || 'kom'),             { x: cols[3]+3, y: cy, font,     size: 9, color: dark });
    page.drawText(fmtAmount(s.cena),                       { x: cols[4]+3, y: cy, font,     size: 9, color: dark });
    page.drawText(fmtAmount(s.ukupno),                     { x: cols[5]+3, y: cy, font: fontBold, size: 9, color: dark });
    y -= rowH;
  });

  y -= 20;

  // ─── 4. TOTAL (right) ────────────────────────────────────────────────────────
  const totalBoxW = 200;
  const totalBoxH = 42;
  const totalX    = width - margin - totalBoxW;

  page.drawText('UKUPNO ZA PLACANJE', { x: totalX, y: y + 4, font, size: 8, color: gray });
  page.drawRectangle({ x: totalX, y: y - totalBoxH + 8, width: totalBoxW, height: totalBoxH, color: dark });
  page.drawText(fmtAmount(f.ukupno), {
    x: totalX + 12,
    y: y - totalBoxH / 2 + 8,
    font: fontBold, size: 13, color: gold,
  });

  // ─── 5. PAYMENT INFO (left) ──────────────────────────────────────────────────
  page.drawText('PODACI ZA PLACANJE', { x: margin, y: y + 4, font: fontBold, size: 8, color: gray });
  const isDevizna = f.valuta !== 'RSD';
  if (isDevizna) {
    page.drawText(`IBAN: ${PREDUZETNIK.iban}`,                                             { x: margin, y: y - 10, font, size: 9, color: dark });
    page.drawText(`SWIFT: ${PREDUZETNIK.swift}  |  Banka: ${PREDUZETNIK.banka}`,           { x: margin, y: y - 23, font, size: 9, color: dark });
  } else {
    page.drawText(`Ziro racun: ${PREDUZETNIK.ziro_rsd}`,                                   { x: margin, y: y - 10, font, size: 9, color: dark });
    page.drawText(`Banka: ${PREDUZETNIK.banka}`,                                           { x: margin, y: y - 23, font, size: 9, color: dark });
  }

  // ─── 6. PDV NOTE ─────────────────────────────────────────────────────────────
  page.drawText(
    'PDV nije obracunat na osnovu clana 33. Zakona o PDV (pausalni poreski obveznik).',
    { x: margin, y: footerH + 8, font, size: 8, color: gray }
  );

  // ─── 7. FOOTER ───────────────────────────────────────────────────────────────
  page.drawRectangle({ x: 0, y: 0, width, height: footerH, color: dark });

  const footerAfterLogo = drawVhirtyLogo(margin, footerH / 2, 16 / 365, 10);
  page.drawText('Ruze Sulman 39, 23000 Zrenjanin  |  hello@vhirty.com  |  vhirty.com', {
    x: footerAfterLogo + 8,
    y: footerH / 2 - 4,
    font, size: 8, color: white,
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
