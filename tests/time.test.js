import test from 'node:test';
import assert from 'node:assert/strict';
import { zonedTime, reminderTimes, addDays } from '../src/time.js';
const settings = { timezone: 'America/Sao_Paulo', reminderTime: '09:00' };
test('São Paulo: horário civil vira UTC', () =>
  assert.equal(
    new Date(zonedTime('2026-10-10', '09:00', 'America/Sao_Paulo')).toISOString(),
    '2026-10-10T12:00:00.000Z',
  ));
test('7 dias, 1 dia e dia atual, sempre no fuso do usuário', () =>
  assert.deepEqual(
    reminderTimes({ date: '2026-10-10', time: '15:00' }, settings, Date.parse('2026-10-01')).map(
      (r) => new Date(r.at).toISOString(),
    ),
    ['2026-10-03T18:00:00.000Z', '2026-10-09T18:00:00.000Z', '2026-10-10T18:00:00.000Z'],
  ));
test('criação perto do prazo descarta horários passados', () =>
  assert.deepEqual(
    reminderTimes({ date: '2026-10-10' }, settings, Date.parse('2026-10-09T13:00Z')).map(
      (r) => r.days,
    ),
    [0],
  ));
test('prazo vencido não agenda', () =>
  assert.equal(
    reminderTimes({ date: '2026-10-10' }, settings, Date.parse('2026-10-11')).length,
    0,
  ));
test('DST: subtração de dias civis preserva hora local', () => {
  const r = reminderTimes(
    { date: '2026-03-09', time: '09:00' },
    { ...settings, timezone: 'America/New_York' },
    0,
  );
  assert.equal(new Date(r[0].at).toISOString(), '2026-03-02T14:00:00.000Z');
  assert.equal(new Date(r[1].at).toISOString(), '2026-03-08T13:00:00.000Z');
});
test('DST: horário inexistente é rejeitado', () =>
  assert.throws(() => zonedTime('2026-03-08', '02:30', 'America/New_York')));
test('DST: horário ambíguo usa primeira ocorrência', () =>
  assert.equal(
    new Date(zonedTime('2026-11-01', '01:30', 'America/New_York')).toISOString(),
    '2026-11-01T05:30:00.000Z',
  ));
test('virada do mês e ano', () => assert.equal(addDays('2027-01-01', -7), '2026-12-25'));
test('cards concluídos ou arquivados não agendam', () => {
  assert.equal(reminderTimes({ date: '2027-01-01', done: true }, settings, 0).length, 0);
  assert.equal(reminderTimes({ date: '2027-01-01', archived: true }, settings, 0).length, 0);
});
