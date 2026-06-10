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
