export type ScheduleKind = 'daily' | 'interval' | 'weekdays' | 'cycle';

export interface MedicationSchedule {
  kind: ScheduleKind;
  times: string[];
  intervalHours: number;
  weekdays: number[];
  activeDays: number;
  restDays: number;
}

export interface Medication {
  id: string;
  name: string;
  strength: string;
  dose: number;
  unit: string;
  stock: number;
  lowStock: number;
  notes: string;
  startAt: number;
  endAt?: number;
  active: boolean;
  schedule: MedicationSchedule;
}

export interface Dose {
  id: string;
  medicationId: string;
  scheduledAt: number;
  recordedAt: number;
  status: 'taken' | 'skipped';
}

export interface AppState {
  medications: Medication[];
  doses: Dose[];
  theme: 'system' | 'light' | 'dark';
}

export const MS_PER_HOUR = 3600000;
export const MS_PER_DAY = 86400000;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAYS = new Set([0, 1, 2, 3, 4, 5, 6]);

export function validateMedication(med: unknown): Medication {
  const m = med as Medication;
  if (!m || typeof m !== 'object') {
    throw new Error('Medication must be an object');
  }
  if (typeof m.id !== 'string' || m.id.length === 0) {
    throw new Error('id must be a non-empty string');
  }
  if (typeof m.name !== 'string' || m.name.trim().length === 0) {
    throw new Error('name must be a non-empty string');
  }
  if (typeof m.strength !== 'string') {
    throw new Error('strength must be a string');
  }
  if (typeof m.dose !== 'number' || !Number.isFinite(m.dose) || m.dose <= 0) {
    throw new Error('dose must be a positive number');
  }
  if (typeof m.unit !== 'string' || m.unit.length === 0) {
    throw new Error('unit must be a non-empty string');
  }
  if (typeof m.stock !== 'number' || !Number.isFinite(m.stock) || m.stock < 0) {
    throw new Error('stock must be a non-negative number');
  }
  if (typeof m.lowStock !== 'number' || !Number.isFinite(m.lowStock) || m.lowStock < 0) {
    throw new Error('lowStock must be a non-negative number');
  }
  if (typeof m.notes !== 'string') {
    throw new Error('notes must be a string');
  }
  if (typeof m.startAt !== 'number' || !Number.isFinite(m.startAt)) {
    throw new Error('startAt must be a number timestamp');
  }
  if (m.endAt !== undefined) {
    if (typeof m.endAt !== 'number' || !Number.isFinite(m.endAt)) {
      throw new Error('endAt must be a number timestamp');
    }
    if (m.endAt <= m.startAt) {
      throw new Error('endAt must be after startAt');
    }
  }
  if (typeof m.active !== 'boolean') {
    throw new Error('active must be a boolean');
  }
  validateSchedule(m.schedule);
  return m;
}

export function validateSchedule(schedule: unknown): MedicationSchedule {
  const s = schedule as MedicationSchedule;
  if (!s || typeof s !== 'object') {
    throw new Error('schedule must be an object');
  }
  if (
    s.kind !== 'daily' &&
    s.kind !== 'interval' &&
    s.kind !== 'weekdays' &&
    s.kind !== 'cycle'
  ) {
    throw new Error('schedule.kind must be daily, interval, weekdays or cycle');
  }
  if (!Array.isArray(s.times)) {
    throw new Error('schedule.times must be an array');
  }
  if (s.kind !== 'interval') {
    if (s.times.length === 0) {
      throw new Error('schedule.times must contain at least one HH:mm time');
    }
    for (const t of s.times) {
      if (typeof t !== 'string' || !TIME_RE.test(t)) {
        throw new Error(`schedule.times entries must be HH:mm strings, got ${JSON.stringify(t)}`);
      }
    }
  }
  if (typeof s.intervalHours !== 'number' || !Number.isFinite(s.intervalHours)) {
    throw new Error('schedule.intervalHours must be a number');
  }
  if (s.kind === 'interval') {
    if (s.intervalHours <= 0 || s.intervalHours > 24 * 30) {
      throw new Error('schedule.intervalHours must be between >0 and 720');
    }
  } else if (s.intervalHours < 0) {
    throw new Error('schedule.intervalHours must be >= 0');
  }
  if (!Array.isArray(s.weekdays)) {
    throw new Error('schedule.weekdays must be an array');
  }
  if (s.kind === 'weekdays') {
    if (s.weekdays.length === 0) {
      throw new Error('schedule.weekdays must contain at least one weekday');
    }
    for (const w of s.weekdays) {
      if (!WEEKDAYS.has(w)) {
        throw new Error('schedule.weekdays entries must be integers 0-6 (Sunday=0)');
      }
    }
  }
  if (typeof s.activeDays !== 'number' || !Number.isInteger(s.activeDays) || s.activeDays < 0) {
    throw new Error('schedule.activeDays must be a non-negative integer');
  }
  if (typeof s.restDays !== 'number' || !Number.isInteger(s.restDays) || s.restDays < 0) {
    throw new Error('schedule.restDays must be a non-negative integer');
  }
  if (s.kind === 'cycle' && s.activeDays < 1) {
    throw new Error('cycle schedules require activeDays >= 1');
  }
  return s;
}

function parseTimeOfLocalDay(time: string, dayStartLocal: number): number {
  const m = TIME_RE.exec(time);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`invalid time ${time}`);
  }
  const d = new Date(dayStartLocal);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return d.getTime();
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function scheduleTimes(med: Medication): string[] {
  if (med.schedule.kind === 'interval') {
    return [];
  }
  return med.schedule.times;
}

function intervalAnchoredAt(med: Medication): number {
  const s = med.schedule;
  if (s.times.length > 0) {
    const anchor = parseTimeOfLocalDay(s.times[0]!, med.startAt);
    if (anchor >= med.startAt) {
      return anchor;
    }
  }
  return med.startAt;
}

function inCycleActiveWindow(med: Medication, ts: number): boolean {
  const { activeDays, restDays } = med.schedule;
  if (restDays <= 0) {
    return true;
  }
  const cycleLen = activeDays + restDays;
  const startDay = Math.floor(startOfLocalDay(med.startAt) / MS_PER_DAY);
  const curDay = Math.floor(startOfLocalDay(ts) / MS_PER_DAY);
  return (curDay - startDay) % cycleLen < activeDays;
}

export function occurrences(med: Medication, from: number, to: number): number[] {
  validateMedication(med);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new Error('occurrences requires from <= to as finite timestamps');
  }
  if (!med.active) {
    return [];
  }
  const now = Date.now();
  const effectiveEnd = med.endAt !== undefined && med.endAt < to ? med.endAt : to;
  const bound = Math.min(effectiveEnd, now + 365 * MS_PER_DAY);
  if (bound < from) {
    return [];
  }
  const out: number[] = [];
  const MAX = 500;
  const push = (ts: number): void => {
    if (ts >= from && ts <= bound && out.length < MAX && !out.includes(ts)) {
      out.push(ts);
    }
  };
  const s = med.schedule;
  if (s.kind === 'interval') {
    const anchor = intervalAnchoredAt(med);
    const step = s.intervalHours * MS_PER_HOUR;
    let first = anchor + Math.ceil((from - anchor) / step) * step;
    if (first < anchor) {
      first = anchor;
    }
    for (let ts = first; ts <= bound && out.length < MAX; ts += step) {
      if (ts < med.startAt) {
        continue;
      }
      if (s.restDays > 0 && !inCycleActiveWindow(med, ts)) {
        continue;
      }
      push(ts);
    }
    return out;
  }
  const firstDay = startOfLocalDay(from);
  const lastDay = startOfLocalDay(bound);
  for (let day = firstDay; day <= lastDay; day += MS_PER_DAY) {
    const dow = new Date(day).getDay();
    if (s.kind === 'weekdays' && !s.weekdays.includes(dow)) {
      continue;
    }
    if (s.kind === 'cycle' && !inCycleActiveWindow(med, day)) {
      continue;
    }
    for (const t of s.times) {
      const ts = parseTimeOfLocalDay(t, day);
      if (ts >= med.startAt) {
        push(ts);
      }
    }
    if (out.length >= MAX) {
      break;
    }
  }
  return out;
}
