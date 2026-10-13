import { randomUUID } from 'node:crypto';
import { reminderTimes } from './time.js';
export function configured() {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}
export async function deliver(payload, key) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': key,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Provedor de e-mail: HTTP ${response.status}`);
  return (await response.json()).id;
}
export function schedule(db, user, record, settings, now = Date.now()) {
  db.prepare(
    "UPDATE reminders SET status='cancelled' WHERE record_id=? AND status IN ('pending','sending')",
  ).run(record.id);
  if (!['event', 'card'].includes(record.kind)) return;
  const sources = [record.data];
  if (record.kind === 'event' && record.data.deadline && record.data.deadline !== record.data.date)
    sources.push({
      ...record.data,
      date: record.data.deadline,
      time: '',
      title: 'Prazo: ' + record.data.title,
    });
  for (const d of sources)
    for (const r of reminderTimes(d, settings, now)) {
      const date = d.date.split('-').reverse().join('/');
      const payload = {
        from: process.env.EMAIL_FROM || '',
        to: [user.email],
        subject: `${r.days === 0 ? 'Hoje' : r.days === 1 ? 'Amanhã' : 'Em uma semana'}: ${d.title}`,
        text: `${d.title}\nData: ${date}\nHorário: ${d.time || 'Sem horário definido'} (${settings.timezone})\nCategoria: ${d.category || 'Tarefa'}\nObservações: ${d.notes || d.description || 'Nenhuma'}\nPrazo: ${d.deadline || d.date}\n\nAbrir: ${process.env.APP_URL || 'http://localhost:3000'}/?record=${record.id}`,
      };
      db.prepare(
        'INSERT INTO reminders(id,user_id,record_id,revision,offset,due,next_attempt,payload) VALUES(?,?,?,?,?,?,?,?)',
      ).run(
        randomUUID(),
        user.id,
        record.id,
        record.version,
        r.days,
        r.at,
        r.at,
        JSON.stringify(payload),
      );
    }
}
export async function runMail(db, send = deliver, now = Date.now(), enabled = configured()) {
  if (!enabled) return;
  db.prepare("UPDATE reminders SET status='pending' WHERE status='sending' AND lease<?").run(now);
  const due = db
    .prepare(
      "SELECT r.* FROM reminders r JOIN users u ON u.id=r.user_id WHERE r.status='pending' AND r.next_attempt<=? AND u.verified=1 ORDER BY r.due LIMIT 30",
    )
    .all(now);
  for (const job of due) {
    if (job.first_attempt && now - job.first_attempt > 23 * 3600000) {
      db.prepare(
        "UPDATE reminders SET status='review',error='Janela segura de repetição expirada' WHERE id=?",
      ).run(job.id);
      continue;
    }
    const claim = db
      .prepare(
        "UPDATE reminders SET status='sending',lease=?,first_attempt=COALESCE(first_attempt,?),attempts=attempts+1 WHERE id=? AND status='pending'",
      )
      .run(now + 60000, now, job.id);
    if (!claim.changes) continue;
    try {
      const payload = JSON.parse(job.payload);
      if (!payload.from) {
        payload.from = process.env.EMAIL_FROM;
        db.prepare('UPDATE reminders SET payload=? WHERE id=?').run(
          JSON.stringify(payload),
          job.id,
        );
      }
      const id = await send(payload, job.id);
      db.prepare("UPDATE reminders SET status='sent',provider_id=?,error=NULL WHERE id=?").run(
        id,
        job.id,
      );
      db.prepare("INSERT INTO mail_logs(reminder_id,at,status,detail) VALUES(?,?,'sent',?)").run(
        job.id,
        now,
        id,
      );
    } catch (e) {
      const failed = job.attempts >= 7;
      db.prepare(
        "UPDATE reminders SET status=?,next_attempt=?,error=? WHERE id=? AND status='sending'",
      ).run(
        failed ? 'failed' : 'pending',
        now + Math.min(3600000, 60000 * 2 ** job.attempts),
        String(e.message),
        job.id,
      );
      db.prepare('INSERT INTO mail_logs(reminder_id,at,status,detail) VALUES(?,?,?,?)').run(
        job.id,
        now,
        failed ? 'failed' : 'retry',
        String(e.message),
      );
      console.error(JSON.stringify({ event: 'mail_error', id: job.id, message: e.message }));
    }
  }
}
