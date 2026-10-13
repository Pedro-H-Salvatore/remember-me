import http from 'node:http';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDB, transaction } from './db.js';
import { schedule, runMail, configured, deliver } from './mail.js';
import { reminderTimes } from './time.js';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dir = resolve(process.env.DATA_DIR || join(root, 'data'));
mkdirSync(join(dir, 'uploads'), { recursive: true });
export const db = openDB(dir);
const port = Number(process.env.PORT || 3000),
  origin = process.env.APP_URL || `http://localhost:${port}`;
const defaults = {
  timezone: 'America/Sao_Paulo',
  reminderTime: '09:00',
  waterGoal: 2000,
  categories: [
    { name: 'Trabalho', color: '#6366f1' },
    { name: 'Reunião', color: '#0284c7' },
    { name: 'Festa', color: '#db2777' },
    { name: 'Outros', color: '#d97706' },
  ],
};
const hash = (s) => createHash('sha256').update(s).digest('hex');
function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}
function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(password, salt, 64).toString('hex');
}
function validPassword(password, stored) {
  const salt = stored.split(':')[0];
  return timingSafeEqual(Buffer.from(passwordHash(password, salt)), Buffer.from(stored));
}
function json(res, status, data, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 8 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail('Arquivo ou conteúdo muito grande.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    fail('Conteúdo inválido.');
  }
}
function userFor(req) {
  const token = /aurora_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token) return null;
  return db
    .prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>?',
    )
    .get(hash(token), Date.now());
}
function session(res, user) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    hash(token),
    user.id,
    Date.now() + 7 * 86400000,
  );
  return {
    'Set-Cookie': `aurora_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${origin.startsWith('https:') ? '; Secure' : ''}`,
  };
}
function info(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    verified: !!user.verified,
    settings: JSON.parse(user.settings),
  };
}
const attempts = new Map();
function rate(req) {
  const key = req.socket.remoteAddress;
  const t = Date.now();
  let entry = attempts.get(key) || { n: 0, until: t + 900000 };
  if (t > entry.until) entry = { n: 0, until: t + 900000 };
  entry.n++;
  attempts.set(key, entry);
  if (entry.n > 30) fail('Muitas tentativas. Aguarde 15 minutos.', 429);
}
setInterval(() => {
  for (const [k, v] of attempts) if (v.until < Date.now()) attempts.delete(k);
  db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
}, 60000).unref();
function validDate(v) {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v + 'T12:00:00Z')) &&
    new Date(v + 'T12:00:00Z').toISOString().slice(0, 10) === v
  );
}
function validate(kind, d, user, id) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) fail('Registro inválido.');
  if (JSON.stringify(d).length > 100000) fail('Registro muito grande.');
  if (!['event', 'note', 'board', 'column', 'card', 'book', 'reading', 'health'].includes(kind))
    fail('Tipo inválido.');
  if (
    ['event', 'note', 'board', 'column', 'card', 'book'].includes(kind) &&
    (!d.title?.trim() || d.title.length > 180)
  )
    fail('Informe um título de até 180 caracteres.');
  if (d.date && !validDate(d.date)) fail('Data inválida.');
  if (d.deadline && !validDate(d.deadline)) fail('Prazo inválido.');
  if (['event', 'health', 'reading'].includes(kind) && !validDate(d.date))
    fail('Informe uma data válida.');
  if (d.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(d.time)) fail('Horário inválido.');
  const owned = (recordId, type) => {
    const r = db
      .prepare('SELECT * FROM records WHERE id=? AND user_id=? AND kind=?')
      .get(recordId, user.id, type);
    if (!r) fail('Registro associado não encontrado.');
    return JSON.parse(r.data);
  };
  if (kind === 'column') owned(d.boardId, 'board');
  if (kind === 'card') {
    owned(d.boardId, 'board');
    const col = owned(d.columnId, 'column');
    if (col.boardId !== d.boardId) fail('Coluna de outro quadro.');
  }
  if (kind === 'book' && (!Number.isInteger(d.pages) || d.pages < 1 || d.pages > 100000))
    fail('Informe o total de páginas.');
  if (kind === 'reading') {
    if (!['yes', 'no'].includes(d.read)) fail('Informe se houve leitura.');
    if (d.read === 'yes') {
      owned(d.bookId, 'book');
      if (!Number.isInteger(d.pages) || d.pages < 1 || d.pages > 100000)
        fail('Informe as páginas lidas.');
    }
  }
  if (kind === 'health') {
    if (!['yes', 'no', ''].includes(d.workout || '')) fail('Treino inválido.');
    if (
      !Number.isFinite(d.water) ||
      d.water < 0 ||
      d.water > 30000 ||
      !Number.isFinite(d.duration) ||
      d.duration < 0 ||
      d.duration > 1440
    )
      fail('Quantidade ou duração inválida.');
    const duplicate = db
      .prepare(
        "SELECT id FROM records WHERE user_id=? AND kind='health' AND json_extract(data,'$.date')=? AND id!=?",
      )
      .get(user.id, d.date, id);
    if (duplicate) fail('Este dia já tem um registro. Atualize-o.', 409);
  }
  for (const f of [...(d.attachments || []), ...(d.cover ? [{ id: d.cover }] : [])])
    if (!db.prepare('SELECT id FROM files WHERE id=? AND user_id=?').get(f.id, user.id))
      fail('Arquivo inválido.');
  if (['event', 'card'].includes(kind)) reminderTimes(d, JSON.parse(user.settings));
}
function unpack(r) {
  return { ...r, data: JSON.parse(r.data) };
}
function removeRecord(id, user) {
  const record = db.prepare('SELECT * FROM records WHERE id=? AND user_id=?').get(id, user.id);
  if (!record) fail('Registro não encontrado.', 404);
  const all = db.prepare('SELECT * FROM records WHERE user_id=?').all(user.id);
  const ids = new Set([id]);
  if (record.kind === 'board')
    for (const r of all) if (JSON.parse(r.data).boardId === id) ids.add(r.id);
  if (record.kind === 'column')
    for (const r of all) if (JSON.parse(r.data).columnId === id) ids.add(r.id);
  if (record.kind === 'book')
    for (const r of all) if (JSON.parse(r.data).bookId === id) ids.add(r.id);
  for (const key of ids) {
    db.prepare(
      "UPDATE reminders SET status='cancelled' WHERE record_id=? AND status IN ('pending','sending')",
    ).run(key);
    db.prepare('DELETE FROM records WHERE id=? AND user_id=?').run(key, user.id);
  }
}
async function verifyEmail(user) {
  if (!configured()) fail('O administrador ainda precisa configurar o serviço de e-mail.', 503);
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO verification VALUES(?,?,?)').run(
    hash(token),
    user.id,
    Date.now() + 86400000,
  );
  await deliver(
    {
      from: process.env.EMAIL_FROM,
      to: [user.email],
      subject: 'Confirme seu e-mail na Remember me',
      text: `Olá, ${user.name}!\nConfirme seu endereço para receber lembretes:\n${origin}/?verify=${token}\nEste link expira em 24 horas.`,
    },
    randomUUID(),
  );
}
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  if (origin.startsWith('https:')) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url, origin),
      path = url.pathname;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== origin)
      fail('Origem da solicitação não autorizada.', 403);
    if (path === '/healthz') {
      db.prepare('SELECT 1').get();
      return json(res, 200, { status: 'ok' });
    }
    if (path === '/api/monitor') {
      if (
        !process.env.MONITOR_TOKEN ||
        req.headers.authorization !== `Bearer ${process.env.MONITOR_TOKEN}`
      )
        fail('Não autorizado.', 401);
      return json(res, 200, {
        emailConfigured: configured(),
        queue: db.prepare('SELECT status,count(*) total FROM reminders GROUP BY status').all(),
        oldest: db.prepare("SELECT min(due) due FROM reminders WHERE status='pending'").get(),
      });
    }
    if (path === '/api/register' && req.method === 'POST') {
      rate(req);
      const b = await body(req, 10000);
      const email = String(b.email || '')
        .trim()
        .toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
        fail('Informe um e-mail válido.');
      if (typeof b.password !== 'string' || b.password.length < 12 || b.password.length > 128)
        fail('Use uma senha com 12 a 128 caracteres.');
      if (!b.name?.trim() || b.name.length > 80) fail('Informe seu nome.');
      if (db.prepare('SELECT id FROM users WHERE email=?').get(email))
        fail('Não foi possível criar a conta. Tente entrar com este e-mail.', 409);
      const user = {
        id: randomUUID(),
        email,
        name: b.name.trim(),
        password: passwordHash(b.password),
        settings: JSON.stringify(defaults),
        verified: 0,
      };
      db.prepare('INSERT INTO users(id,email,name,password,settings) VALUES(?,?,?,?,?)').run(
        user.id,
        email,
        user.name,
        user.password,
        user.settings,
      );
      return json(res, 201, info(user), session(res, user));
    }
    if (path === '/api/login' && req.method === 'POST') {
      rate(req);
      const b = await body(req, 10000);
      const u = db.prepare('SELECT * FROM users WHERE email=?').get(
        String(b.email || '')
          .trim()
          .toLowerCase(),
      );
      if (
        typeof b.password !== 'string' ||
        b.password.length > 128 ||
        !u ||
        !validPassword(b.password, u.password)
      )
        fail('E-mail ou senha incorretos.', 401);
      return json(res, 200, info(u), session(res, u));
    }
    const user = userFor(req);
    if (path.startsWith('/api/') && !user) fail('Entre na sua conta para continuar.', 401);
    if (path === '/api/logout' && req.method === 'POST') {
      const token = /aurora_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
      if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(hash(token));
      return json(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': 'aurora_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' },
      );
    }
    if (path === '/api/me' && req.method === 'GET')
      return json(res, 200, { ...info(user), emailConfigured: configured() });
    if (path === '/api/verify/send' && req.method === 'POST') {
      rate(req);
      await verifyEmail(user);
      return json(res, 200, { ok: true });
    }
    if (path === '/api/verify' && req.method === 'POST') {
      const b = await body(req, 1000);
      const v = db
        .prepare('SELECT * FROM verification WHERE token=? AND user_id=? AND expires>?')
        .get(hash(String(b.token)), user.id, Date.now());
      if (!v) fail('Link inválido ou expirado.');
      transaction(db, () => {
        db.prepare('UPDATE users SET verified=1 WHERE id=?').run(user.id);
        db.prepare('DELETE FROM verification WHERE user_id=?').run(user.id);
      });
      return json(res, 200, { ok: true });
    }
    if (path === '/api/settings' && req.method === 'PUT') {
      const s = await body(req, 20000);
      if (typeof s.timezone !== 'string' || !s.timezone || s.timezone.length > 100)
        fail('Informe um fuso horário válido.');
      try {
        new Intl.DateTimeFormat('pt-BR', { timeZone: s.timezone });
      } catch {
        fail('Fuso horário inválido.');
      }
      if (
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.reminderTime) ||
        !Number.isInteger(s.waterGoal) ||
        s.waterGoal < 100 ||
        s.waterGoal > 10000
      )
        fail('Horário ou meta inválidos.');
      if (
        !Array.isArray(s.categories) ||
        s.categories.length > 50 ||
        s.categories.some((c) => !c.name || c.name.length > 50 || !/^#[0-9a-f]{6}$/i.test(c.color))
      )
        fail('Categorias inválidas.');
      transaction(db, () => {
        db.prepare('UPDATE users SET settings=? WHERE id=?').run(JSON.stringify(s), user.id);
        for (const r of db
          .prepare("SELECT * FROM records WHERE user_id=? AND kind IN ('event','card')")
          .all(user.id))
          schedule(db, user, unpack(r), s);
      });
      return json(res, 200, { ok: true });
    }
    if (path === '/api/records' && req.method === 'GET')
      return json(
        res,
        200,
        db
          .prepare('SELECT * FROM records WHERE user_id=? ORDER BY updated DESC')
          .all(user.id)
          .map(unpack),
      );
    if (path === '/api/records' && req.method === 'POST') {
      const b = await body(req, 120000),
        id = randomUUID();
      validate(b.kind, b.data, user, id);
      const record = {
        id,
        kind: b.kind,
        data: b.data,
        version: 1,
        updated: new Date().toISOString(),
      };
      transaction(db, () => {
        db.prepare('INSERT INTO records(id,user_id,kind,data,updated) VALUES(?,?,?,?,?)').run(
          id,
          user.id,
          b.kind,
          JSON.stringify(b.data),
          record.updated,
        );
        schedule(db, user, record, JSON.parse(user.settings));
      });
      return json(res, 201, record);
    }
    const match = /^\/api\/records\/([a-f0-9-]+)$/.exec(path);
    if (match) {
      const old = db
        .prepare('SELECT * FROM records WHERE id=? AND user_id=?')
        .get(match[1], user.id);
      if (!old) fail('Registro não encontrado.', 404);
      if (req.method === 'DELETE') {
        transaction(db, () => removeRecord(old.id, user));
        return json(res, 200, { ok: true });
      }
      if (req.method === 'PUT') {
        const b = await body(req, 120000);
        if (b.version !== old.version)
          fail('Este registro mudou em outro dispositivo. Recarregue antes de salvar.', 409);
        validate(old.kind, b.data, user, old.id);
        const record = {
          ...old,
          data: b.data,
          version: old.version + 1,
          updated: new Date().toISOString(),
        };
        transaction(db, () => {
          db.prepare('UPDATE records SET data=?,version=?,updated=? WHERE id=?').run(
            JSON.stringify(b.data),
            record.version,
            record.updated,
            old.id,
          );
          // Keep pending jobs for changes unrelated to their visible content and timing.
          const fields = [
            'title',
            'date',
            'time',
            'deadline',
            'category',
            'notes',
            'description',
            'archived',
            'done',
          ];
          const prev = JSON.parse(old.data);
          if (fields.some((k) => JSON.stringify(prev[k]) !== JSON.stringify(b.data[k])))
            schedule(db, user, record, JSON.parse(user.settings));
        });
        return json(res, 200, record);
      }
    }
    if (path === '/api/mail' && req.method === 'GET')
      return json(
        res,
        200,
        db
          .prepare(
            'SELECT id,record_id,due,status,attempts,error FROM reminders WHERE user_id=? ORDER BY due DESC LIMIT 100',
          )
          .all(user.id),
      );
    if (path === '/api/files' && req.method === 'POST') {
      const b = await body(req);
      if (typeof b.base64 !== 'string' || typeof b.name !== 'string') fail('Arquivo inválido.');
      const buffer = Buffer.from(b.base64, 'base64');
      if (buffer.length > 5 * 1024 * 1024 || !buffer.length) fail('Envie um arquivo de até 5 MB.');
      const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const jpg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
      const pdf = buffer.subarray(0, 5).toString() === '%PDF-';
      const mime = png ? 'image/png' : jpg ? 'image/jpeg' : pdf ? 'application/pdf' : null;
      if (!mime || mime !== b.mime) fail('Formatos aceitos: JPEG, PNG ou PDF.');
      const id = randomUUID();
      writeFileSync(join(dir, 'uploads', id), buffer, { flag: 'wx' });
      db.prepare('INSERT INTO files VALUES(?,?,?,?,?)').run(
        id,
        user.id,
        b.name.slice(0, 180),
        mime,
        buffer.length,
      );
      return json(res, 201, { id, name: b.name.slice(0, 180) });
    }
    const fileMatch = /^\/api\/files\/([a-f0-9-]+)$/.exec(path);
    if (fileMatch && req.method === 'GET') {
      const f = db
        .prepare('SELECT * FROM files WHERE id=? AND user_id=?')
        .get(fileMatch[1], user.id);
      if (!f) fail('Arquivo não encontrado.', 404);
      res.writeHead(200, {
        'Content-Type': f.mime,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': `${f.mime === 'application/pdf' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      });
      return res.end(readFileSync(join(dir, 'uploads', f.id)));
    }
    if (path.startsWith('/api/')) fail('Operação não encontrada.', 404);
    if (!['GET', 'HEAD'].includes(req.method)) fail('Método não permitido.', 405);
    const staticPath = path === '/' ? 'index.html' : path.slice(1);
    if (!['index.html', 'app.js', 'style.css', 'favicon.svg'].includes(staticPath))
      fail('Página não encontrada.', 404);
    const content = readFileSync(join(root, 'public', staticPath));
    res.writeHead(200, {
      'Content-Type': {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
      }[extname(staticPath)],
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  } catch (e) {
    if (!e.status)
      console.error(
        JSON.stringify({
          event: 'request_error',
          message: e.message,
          path: req.url?.split('?')[0],
        }),
      );
    json(res, e.status || 500, {
      error: e.status
        ? e.message
        : 'Não foi possível concluir. Tente novamente; seus campos foram preservados.',
    });
  }
});
if (
  process.env.NODE_ENV === 'production' &&
  (!origin.startsWith('https://') || !process.env.MONITOR_TOKEN)
)
  throw new Error('Produção exige APP_URL HTTPS e MONITOR_TOKEN.');
if (process.env.NODE_ENV !== 'test') {
  server.listen(port, process.env.HOST || '127.0.0.1', () =>
    console.log(`Remember me disponível em ${origin}`),
  );
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runMail(db);
    } catch (e) {
      console.error(JSON.stringify({ event: 'scheduler_error', message: e.message }));
    } finally {
      busy = false;
    }
  };
  const interval = setInterval(tick, 15000);
  tick();
  process.on('SIGTERM', () => {
    clearInterval(interval);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
