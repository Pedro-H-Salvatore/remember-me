import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function openDB(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'aurora.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(
    `CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY, applied TEXT NOT NULL);`,
  );
  if (!db.prepare('SELECT 1 FROM migrations WHERE version=1').get())
    db.exec(`BEGIN;
 CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,name TEXT NOT NULL,password TEXT NOT NULL,verified INTEGER NOT NULL DEFAULT 0,settings TEXT NOT NULL);
 CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
 CREATE TABLE verification(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE records(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL,data TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated TEXT NOT NULL);
 CREATE INDEX records_owner_kind ON records(user_id,kind);
 CREATE TABLE files(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL);
 CREATE TABLE reminders(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),record_id TEXT NOT NULL,revision INTEGER NOT NULL,offset INTEGER NOT NULL,due INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL,first_attempt INTEGER,payload TEXT NOT NULL,provider_id TEXT,error TEXT,lease INTEGER);
 CREATE INDEX reminders_due ON reminders(status,next_attempt);
 CREATE TABLE mail_logs(id INTEGER PRIMARY KEY,reminder_id TEXT,at INTEGER NOT NULL,status TEXT NOT NULL,detail TEXT);
 INSERT INTO migrations VALUES(1,datetime('now')); COMMIT;`);
  return db;
}
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
