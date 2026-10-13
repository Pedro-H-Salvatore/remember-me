export type Kind = 'event' | 'note' | 'board' | 'column' | 'card' | 'book' | 'reading' | 'health';
export interface Settings {
  timezone: string;
  reminderTime: string;
  waterGoal: number;
  categories: Array<{ name: string; color: string }>;
}
export interface DatedItem {
  title?: string;
  date?: string;
  time?: string;
  deadline?: string;
  archived?: boolean;
  done?: boolean;
}
export interface ReminderTime {
  days: number;
  at: number;
}
export interface RecordEnvelope<T> {
  id: string;
  kind: Kind;
  data: T;
  version: number;
  updated: string;
}
export type MailStatus = 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed' | 'review';
