import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'aurora-api-'));
process.env.APP_URL = 'http://localhost:3999';
const { server, db } = await import('../src/server.js');
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
test('fluxos essenciais, isolamento, conflitos, anexos e sincronização', async (t) => {
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  });
  async function req(path, method = 'GET', data, cookie = '') {
    const response = await fetch(base + '/api' + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3999',
        Cookie: cookie,
      },
      body: data ? JSON.stringify(data) : undefined,
    });
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  assert.equal((await req('/records')).status, 401);
  const a = await req('/register', 'POST', {
    name: 'Ana',
    email: 'ana@example.invalid',
    password: 'Senha-de-teste-123',
  });
  assert.equal(a.status, 201);
  const b = await req('/register', 'POST', {
    name: 'Bia',
    email: 'bia@example.invalid',
    password: 'Outra-senha-12345',
  });
  const cookie = a.cookie;
  assert.equal(
    (await req('/login', 'POST', { email: 'ana@example.invalid', password: 'Senha-de-teste-123' }))
      .status,
    200,
  );
  assert.equal(
    (await req('/login', 'POST', { email: 'ana@example.invalid', password: 'errada' })).status,
    401,
  );
  const create = async (kind, data) => (await req('/records', 'POST', { kind, data }, cookie)).data;
  const board = await create('board', { title: 'Projeto' }),
    column = await create('column', { title: 'A fazer', boardId: board.id, order: 0 });
  const card = await create('card', {
    title: 'Entrega',
    boardId: board.id,
    columnId: column.id,
    date: '2099-10-10',
    order: 0,
  });
  assert.equal(card.version, 1);
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM reminders WHERE record_id=? AND status='pending'")
      .get(card.id).n,
    3,
  );
  assert.equal(
    (
      await req(
        '/records/' + card.id,
        'PUT',
        { version: card.version, data: { ...card.data, title: 'Outro' } },
        b.cookie,
      )
    ).status,
    404,
  );
  assert.equal((await req('/records', 'GET', null, b.cookie)).data.length, 0);
  const updated = await req(
    '/records/' + card.id,
    'PUT',
    { version: 1, data: { ...card.data, date: '2099-10-12' } },
    cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal(
    (await req('/records/' + card.id, 'PUT', { version: 1, data: card.data }, cookie)).status,
    409,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM reminders WHERE record_id=? AND status='cancelled'")
      .get(card.id).n,
    3,
  );
  assert.equal(
    (await req('/records', 'GET', null, cookie)).data.filter((r) => r.kind === 'event').length,
    0,
    'card is the calendar source; no copied event',
  );
  const note = await create('note', {
    title: 'Ideia',
    content: 'Texto',
    date: '2026-10-10',
    pinned: true,
    tags: ['pessoal'],
    linked: true,
  });
  assert.equal(note.data.content, 'Texto');
  const book = await create('book', { title: 'Livro', pages: 200, status: 'Lendo' });
  const reading = await create('reading', {
    date: '2026-10-10',
    bookId: book.id,
    read: 'yes',
    pages: 25,
  });
  assert.equal(reading.data.pages, 25);
  assert.equal(
    (await create('reading', { date: '2026-10-11', read: 'no', pages: 0 })).data.read,
    'no',
  );
  const health = await create('health', {
    date: '2026-10-10',
    workout: 'no',
    duration: 0,
    water: 500,
  });
  assert.equal(health.data.workout, 'no');
  assert.equal(
    (await req('/records', 'POST', { kind: 'health', data: health.data }, cookie)).status,
    409,
  );
  assert.equal(
    (
      await req(
        '/records',
        'POST',
        { kind: 'event', data: { title: 'Inválido', date: '2026-02-30' } },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await req(
        '/files',
        'POST',
        {
          name: 'x.png',
          mime: 'image/png',
          base64: Buffer.from('html malicious').toString('base64'),
        },
        cookie,
      )
    ).status,
    400,
  );
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhxcAAAAASUVORK5CYII=';
  const file = await req(
    '/files',
    'POST',
    { name: 'capa.png', mime: 'image/png', base64: png },
    cookie,
  );
  assert.equal(file.status, 201);
  assert.equal((await req('/files/' + file.data.id, 'GET', null, b.cookie)).status, 404);
  await req('/records/' + board.id, 'DELETE', {}, cookie);
  assert.equal(
    (await req('/records', 'GET', null, cookie)).data.some((r) => r.id === card.id),
    false,
  );
  assert.equal(
    db
      .prepare("SELECT count(*) n FROM reminders WHERE record_id=? AND status='pending'")
      .get(card.id).n,
    0,
  );
  const csrf = await fetch(base + '/api/records', {
    method: 'POST',
    headers: { Origin: 'http://evil.invalid', Cookie: cookie, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(csrf.status, 403);
  await req('/logout', 'POST', {}, cookie);
  assert.equal((await req('/me', 'GET', null, cookie)).status, 401);
});
