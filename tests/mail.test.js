import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDB, transaction } from '../src/db.js';
import { schedule, runMail } from '../src/mail.js';
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'aurora-test-')),
    db = openDB(dir);
  t.after(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const user = { id: 'u', email: 'test@example.invalid' };
  const settings = { timezone: 'America/Sao_Paulo', reminderTime: '09:00' };
  db.prepare('INSERT INTO users(id,email,name,password,verified,settings) VALUES(?,?,?,?,1,?)').run(
    'u',
    user.email,
    'Teste',
    'no-password',
    JSON.stringify(settings),
  );
  const record = {
    id: 'e',
    kind: 'event',
    version: 1,
    data: { title: 'Consulta', date: '2026-10-10' },
  };
  return { db, user, settings, record };
}
test('atualização cancela envios anteriores e agenda novos', (t) => {
  const { db, user, settings, record } = setup(t);
  schedule(db, user, record, settings, 0);
  record.data.date = '2026-10-12';
  record.version++;
  schedule(db, user, record, settings, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM reminders WHERE status='cancelled'").get().n, 3);
  assert.equal(db.prepare("SELECT count(*) n FROM reminders WHERE status='pending'").get().n, 3);
});
test('compromisso e prazo distinto recebem lembretes', (t) => {
  const { db, user, settings, record } = setup(t);
  record.data.deadline = '2026-10-15';
  schedule(db, user, record, settings, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM reminders').get().n, 6);
});
test('envio idempotente, concorrência e registro de resultado', async (t) => {
  const { db, user, settings, record } = setup(t);
  schedule(db, user, record, settings, Date.parse('2026-10-10T11:00Z'));
  let count = 0;
  const send = async () => {
    count++;
    await new Promise((r) => setTimeout(r, 20));
    return 'mail-id';
  };
  await Promise.all([
    runMail(db, send, Date.parse('2026-10-10T12:01Z'), true),
    runMail(db, send, Date.parse('2026-10-10T12:01Z'), true),
  ]);
  await runMail(db, send, Date.parse('2026-10-10T12:02Z'), true);
  assert.equal(count, 1);
  assert.equal(db.prepare('SELECT status FROM reminders').get().status, 'sent');
  assert.equal(db.prepare('SELECT count(*) n FROM mail_logs').get().n, 1);
});
test('falha transitória repete com a mesma chave e o mesmo payload', async (t) => {
  const { db, user, settings, record } = setup(t);
  schedule(db, user, record, settings, Date.parse('2026-10-10T11:00Z'));
  const calls = [];
  const send = async (p, k) => {
    calls.push([JSON.stringify(p), k]);
    if (calls.length === 1) throw new Error('offline');
    return 'ok';
  };
  const now = Date.parse('2026-10-10T12:01Z');
  await runMail(db, send, now, true);
  await runMail(db, send, now + 61000, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(db.prepare('SELECT attempts FROM reminders').get().attempts, 2);
});
test('crash com lease expirado recupera e janela de 23h exige revisão', async (t) => {
  const { db, user, settings, record } = setup(t);
  schedule(db, user, record, settings, Date.parse('2026-10-10T11:00Z'));
  const now = Date.parse('2026-10-10T12:01Z');
  db.prepare("UPDATE reminders SET status='sending',lease=?,first_attempt=?").run(
    now - 1,
    now - 24 * 3600000,
  );
  let count = 0;
  await runMail(
    db,
    async () => {
      count++;
    },
    now,
    true,
  );
  assert.equal(count, 0);
  assert.equal(db.prepare('SELECT status FROM reminders').get().status, 'review');
});
test('e-mail não confirmado e configuração ausente não enviam', async (t) => {
  const { db, user, settings, record } = setup(t);
  schedule(db, user, record, settings, 0);
  db.prepare('UPDATE users SET verified=0').run();
  let n = 0;
  await runMail(
    db,
    async () => {
      n++;
    },
    Date.parse('2027-01-01'),
    true,
  );
  db.prepare('UPDATE users SET verified=1').run();
  await runMail(
    db,
    async () => {
      n++;
    },
    Date.parse('2027-01-01'),
    false,
  );
  assert.equal(n, 0);
});
test('transação reverte atualização parcial em falha', (t) => {
  const { db } = setup(t);
  assert.throws(() =>
    transaction(db, () => {
      db.prepare('UPDATE users SET name=?').run('Outro');
      throw Error('falha');
    }),
  );
  assert.equal(db.prepare('SELECT name FROM users').get().name, 'Teste');
});
