import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState as RNAppState,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import notifee from '@notifee/react-native';
import {
  MS_PER_DAY,
  occurrences,
  type AppState,
  type Dose,
  type Medication,
  type MedicationSchedule,
  type ScheduleKind,
  validateSchedule,
} from './domain';
import {
  addStock,
  deleteMedication,
  loadState,
  recordDose,
  saveMedication,
  setTheme,
} from './storage';
import {
  handleNotificationEvent,
  requestNotifications,
  snooze,
  syncNotifications,
} from './notifications';
import { exportReport } from './reports';
import { Logo } from './assets/Logo';

export type ThemeChoice = 'system' | 'light' | 'dark';

type Palette = {
  bg: string;
  card: string;
  hero: string;
  heroText: string;
  text: string;
  sub: string;
  border: string;
  accent: string;
  accentSoft: string;
  danger: string;
  warn: string;
  ok: string;
  chipIdle: string;
};

const LIGHT: Palette = {
  bg: '#F4F8F7',
  card: '#FFFFFF',
  hero: '#14424C',
  heroText: '#F4FAF9',
  text: '#1A3E45',
  sub: '#6B8F94',
  border: '#E2EDEB',
  accent: '#2A9D8F',
  accentSoft: '#DFF0EC',
  danger: '#C05B52',
  warn: '#A97A1F',
  ok: '#2E8B5E',
  chipIdle: '#EDF4F3',
};

const DARK: Palette = {
  bg: '#0E1E24',
  card: '#162E36',
  hero: '#1B4A57',
  heroText: '#EAF6F4',
  text: '#E6F2F0',
  sub: '#9DBEC3',
  border: '#294851',
  accent: '#5CC4B4',
  accentSoft: '#1E4049',
  danger: '#E8948A',
  warn: '#E0B96F',
  ok: '#7BD3A4',
  chipIdle: '#1F3A43',
};

const TABS = [
  { key: 'hoy', label: 'Hoy' },
  { key: 'meds', label: 'Medicamentos' },
  { key: 'historial', label: 'Historial' },
  { key: 'ajustes', label: 'Ajustes' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const UNITS = ['comprimido', 'tableta', 'cápsula', 'ml', 'gotas', 'inyección', 'parche'];
const WEEKDAY_SHORT = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const WEEKDAY_FULL = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
];

const KIND_OPTIONS: Array<{ kind: ScheduleKind; label: string }> = [
  { kind: 'daily', label: 'Todos los días' },
  { kind: 'interval', label: 'Por intervalo de horas' },
  { kind: 'weekdays', label: 'Días de la semana' },
  { kind: 'cycle', label: 'Ciclo con descanso' },
];

type TStyles = ReturnType<typeof makeStyles>;


type MedDraft = {
  name: string;
  strength: string;
  dose: string;
  unit: string;
  stock: string;
  lowStock: string;
  notes: string;
  startInput: string;
  endInput: string;
  kind: ScheduleKind;
  times: string;
  intervalHours: string;
  weekdays: number[];
  activeDays: string;
  restDays: string;
};

type HistoryFilter = 'all' | 'taken' | 'skipped';

type DoseActions = {
  markTaken: (med: Medication, scheduledAt: number) => void;
  markSkipped: (med: Medication, scheduledAt: number) => void;
  snoozeDose: (med: Medication, scheduledAt: number) => void;
};


function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fmtLocalDT(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${fmtClock(ts)}`;
}

function toLocalInput(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseLocalDT(raw: string): number | undefined {
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(s);
  if (!m) {
    return undefined;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dd = Number(m[3]);
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const dt = new Date(y, mo - 1, dd, h, mi, 0, 0);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== dd ||
    dt.getHours() !== h ||
    dt.getMinutes() !== mi
  ) {
    return undefined;
  }
  return dt.getTime();
}

function parseNumStrict(raw: string): number | undefined {
  const s = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return undefined;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function parseTimesInput(raw: string): string[] | undefined {
  const parts = raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (parts.length === 0) {
    return undefined;
  }
  if (!parts.every((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t))) {
    return undefined;
  }
  return [...new Set(parts)].sort();
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function humanSchedule(s: MedicationSchedule): string {
  if (s.kind === 'daily') {
    return `Todos los días a las ${s.times.join(', ')}`;
  }
  if (s.kind === 'interval') {
    return `Cada ${s.intervalHours} h${s.times.length > 0 ? ` (ancla ${s.times[0]})` : ''}`;
  }
  if (s.kind === 'weekdays') {
    return `${s.weekdays.map((w) => WEEKDAY_FULL[w] ?? '').join(', ')} a las ${s.times.join(', ')}`;
  }
  return `Ciclo: ${s.activeDays} día(s) activo(s) y ${s.restDays} de descanso a las ${s.times.join(', ')}`;
}

function statusLabel(status: Dose['status']): string {
  return status === 'taken' ? 'Tomada' : 'Omitida';
}

function humanError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/name must be a non-empty/i.test(msg)) {
    return 'Escribe el nombre del medicamento.';
  }
  if (/dose must be a positive/i.test(msg)) {
    return 'La dosis por toma debe ser un número mayor que cero.';
  }
  if (/stock must be a non-negative/i.test(msg)) {
    return 'El stock no puede ser negativo.';
  }
  if (/lowStock must be a non-negative/i.test(msg)) {
    return 'El aviso de stock bajo no puede ser negativo.';
  }
  if (/endAt must be after startAt/i.test(msg)) {
    return 'La fecha de fin debe ser posterior a la de inicio.';
  }
  if (/times entries must be HH:mm/i.test(msg)) {
    return 'Escribe las horas en formato 24 h separadas por comas, por ejemplo 08:00, 20:30.';
  }
  if (/times must contain at least one/i.test(msg)) {
    return 'Añade al menos una hora (HH:mm).';
  }
  if (/weekdays must contain at least one/i.test(msg)) {
    return 'Selecciona al menos un día de la semana.';
  }
  if (/intervalHours must be between/i.test(msg)) {
    return 'El intervalo en horas debe ser mayor que 0 y como máximo 720.';
  }
  if (/cycle schedules require activeDays/i.test(msg)) {
    return 'El ciclo necesita al menos 1 día activo.';
  }
  if (/quantity must be a positive/i.test(msg)) {
    return 'La cantidad a añadir debe ser un número mayor que cero.';
  }
  return 'Ocurrió un problema. Inténtalo de nuevo.';
}

type DoseRow = { med: Medication; scheduledAt: number; dose?: Dose };

function buildDoseRows(
  meds: Medication[],
  doses: Dose[],
  from: number,
  to: number,
): DoseRow[] {
  const rows: DoseRow[] = [];
  for (const med of meds) {
    if (!med.active) {
      continue;
    }
    for (const ts of occurrences(med, from, to)) {
      const dose = doses.find((d) => d.medicationId === med.id && d.scheduledAt === ts);
      rows.push({ med, scheduledAt: ts, dose });
    }
  }
  rows.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return rows;
}

function makeDraft(med?: Medication): MedDraft {
  const startTs = med !== undefined ? med.startAt : Date.now();
  return {
    name: med?.name ?? '',
    strength: med?.strength ?? '',
    dose: med !== undefined ? String(med.dose) : '1',
    unit: med?.unit ?? 'comprimido',
    stock: med !== undefined ? String(med.stock) : '',
    lowStock: med !== undefined ? String(med.lowStock) : '5',
    notes: med?.notes ?? '',
    startInput: toLocalInput(startTs),
    endInput: med?.endAt !== undefined ? toLocalInput(med.endAt) : '',
    kind: med?.schedule.kind ?? 'daily',
    times:
      med !== undefined && med.schedule.kind !== 'interval'
        ? med.schedule.times.join(', ')
        : med?.schedule.kind === 'interval' && med.schedule.times.length > 0
          ? med.schedule.times[0]
          : '08:00',
    intervalHours: med?.schedule.kind === 'interval' ? String(med.schedule.intervalHours) : '8',
    weekdays:
      med?.schedule.kind === 'weekdays' ? [...med.schedule.weekdays].sort((a, b) => a - b) : [1, 2, 3, 4, 5],
    activeDays: med?.schedule.kind === 'cycle' ? String(med.schedule.activeDays) : '21',
    restDays: med?.schedule.kind === 'cycle' ? String(med.schedule.restDays) : '7',
  };
}

function buildMedication(draft: MedDraft, existing?: Medication): Medication {
  const startAt = parseLocalDT(draft.startInput);
  if (startAt === undefined) {
    throw new FormError('startInput', 'Escribe la fecha y hora de inicio (AAAA-MM-DD HH:MM).');
  }
  let endAt: number | undefined;
  if (draft.endInput.trim().length > 0) {
    const endTs = parseLocalDT(draft.endInput);
    if (endTs === undefined) {
      throw new FormError('endInput', 'Escribe una fecha de fin válida (AAAA-MM-DD HH:MM) o déjalo vacío.');
    }
    if (endTs <= startAt) {
      throw new FormError('endInput', 'La fecha de fin debe ser posterior a la de inicio.');
    }
    endAt = endTs;
  }
  const dose = parseNumStrict(draft.dose);
  if (dose === undefined || dose <= 0) {
    throw new FormError('dose', 'La dosis por toma debe ser un número mayor que cero.');
  }
  const stock = parseNumStrict(draft.stock);
  if (stock === undefined) {
    throw new FormError('stock', 'El stock debe ser un número igual o mayor que cero.');
  }
  const lowStock = parseNumStrict(draft.lowStock);
  if (lowStock === undefined) {
    throw new FormError('lowStock', 'El aviso de stock bajo debe ser un número igual o mayor que cero.');
  }
  const name = draft.name.trim();
  if (name.length === 0) {
    throw new FormError('name', 'Escribe el nombre del medicamento.');
  }
  const unit = draft.unit.trim();
  if (unit.length === 0) {
    throw new FormError('unit', 'Elige una unidad.');
  }
  const schedule = buildSchedule(draft);
  const med: Medication = {
    id: existing !== undefined ? existing.id : `med-${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
    name,
    strength: draft.strength.trim(),
    dose,
    unit,
    stock,
    lowStock,
    notes: draft.notes.trim(),
    startAt,
    endAt,
    active: existing !== undefined ? existing.active : true,
    schedule,
  };
  return med;
}

function buildSchedule(draft: MedDraft): MedicationSchedule {
  const times =
    draft.kind === 'interval' && draft.times.trim().length === 0
      ? []
      : parseTimesInput(draft.times);
  if (draft.kind !== 'interval') {
    if (times === undefined || times.length === 0) {
      throw new FormError('times', 'Escribe al menos una hora válida HH:mm separada por comas.');
    }
  } else if (times === undefined) {
    throw new FormError('times', 'El ancla debe ser una hora válida HH:mm (opcional).');
  }
  let intervalHours = 0;
  if (draft.kind === 'interval') {
    const h = parseNumStrict(draft.intervalHours);
    if (h === undefined || h <= 0 || h > 720) {
      throw new FormError('intervalHours', 'El intervalo debe ser mayor que 0 y como máximo 720 horas.');
    }
    intervalHours = h;
  }
  let weekdays: number[] = [];
  if (draft.kind === 'weekdays') {
    if (draft.weekdays.length === 0) {
      throw new FormError('weekdays', 'Selecciona al menos un día de la semana.');
    }
    weekdays = draft.weekdays;
  }
  let activeDays = 0;
  let restDays = 0;
  if (draft.kind === 'cycle') {
    const a = parseNumStrict(draft.activeDays);
    const r = parseNumStrict(draft.restDays);
    if (a === undefined || !Number.isInteger(a) || a < 1) {
      throw new FormError('activeDays', 'Los días activos deben ser un número entero igual o mayor que 1.');
    }
    if (r === undefined || !Number.isInteger(r) || r < 0) {
      throw new FormError('restDays', 'Los días de descanso deben ser un número entero igual o mayor que 0.');
    }
    activeDays = a;
    restDays = r;
  }
  const schedule: MedicationSchedule = {
    kind: draft.kind,
    times: draft.kind === 'interval' ? (times.length > 0 ? [times[0]] : []) : times,
    intervalHours,
    weekdays,
    activeDays,
    restDays,
  };
  try {
    validateSchedule(schedule);
  } catch (e) {
    throw new FormError('times', humanError(e));
  }
  return schedule;
}

class FormError extends Error {
  field: keyof MedDraft | 'form';

  constructor(field: keyof MedDraft | 'form', message: string) {
    super(message);
    this.field = field;
  }
}

function makeStyles(p: Palette) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    loadingText: { color: p.sub, marginTop: 8 },
    safe: { flex: 1, backgroundColor: p.bg },
    scroll: { flex: 1 },
    content: { padding: 16, paddingBottom: 32, gap: 12 },
    h1: { fontSize: 22, fontWeight: '700', color: p.text },
    h2: { fontSize: 17, fontWeight: '700', color: p.text, marginTop: 4 },
    sub: { color: p.sub, fontSize: 13 },
    card: {
      backgroundColor: p.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      shadowColor: '#0E3A47',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 2,
    },
    hero: {
      backgroundColor: p.hero,
      borderRadius: 24,
      padding: 20,
      shadowColor: '#0E3A47',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.16,
      shadowRadius: 14,
      elevation: 4,
    },
    heroTitle: { color: p.heroText, fontSize: 13, fontWeight: '600', opacity: 0.85 },
    heroPct: { color: p.heroText, fontSize: 40, fontWeight: '800', marginTop: 2 },
    heroSub: { color: p.heroText, fontSize: 13, opacity: 0.85, marginTop: 2 },
    heroBar: {
      marginTop: 12,
      height: 8,
      borderRadius: 4,
      backgroundColor: 'rgba(255,255,255,0.25)',
      overflow: 'hidden',
    },
    heroBarFill: { height: 8, borderRadius: 4, backgroundColor: p.accent },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    rowGap: { flexDirection: 'row', gap: 10 },
    colFlex: { flex: 1 },
    chip: {
      minHeight: 36,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.chipIdle,
    },
    chipOn: { backgroundColor: p.accentSoft, borderColor: p.accent },
    chipDanger: { borderColor: p.danger },
    chipText: { color: p.text, fontSize: 13, fontWeight: '600' },
    chipTextOn: { color: p.accent, fontWeight: '800' },
    chipTextDanger: { color: p.danger },
    btn: {
      minHeight: 46,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: p.accent,
      backgroundColor: p.accentSoft,
    },
    btnPrimary: { backgroundColor: p.accent, borderColor: p.accent },
    btnDanger: { backgroundColor: 'transparent', borderColor: p.danger },
    btnSmall: { minHeight: 40 },
    btnFlex: { flex: 1 },
    btnDisabled: { opacity: 0.5 },
    gapSm: { height: 8 },
    selfStart: { alignSelf: 'flex-start' },
    btnText: { color: p.accent, fontWeight: '700', fontSize: 14 },
    btnTextPrimary: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
    btnTextDanger: { color: p.danger, fontWeight: '700', fontSize: 14 },
    doseCard: {
      backgroundColor: p.card,
      borderRadius: 20,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: p.border,
      gap: 10,
      shadowColor: '#0E3A47',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.07,
      shadowRadius: 10,
      elevation: 2,
    },
    doseName: { fontSize: 16, fontWeight: '700', color: p.text, flexShrink: 1 },
    doseMeta: { color: p.sub, fontSize: 13 },
    statusPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      alignSelf: 'flex-start',
    },
    pillTaken: { backgroundColor: p.accentSoft },
    pillSkipped: { backgroundColor: p.chipIdle },
    pillLate: { backgroundColor: p.chipIdle },
    pillText: { fontSize: 12, fontWeight: '700' },
    textTaken: { color: p.ok },
    textSkipped: { color: p.sub },
    textLate: { color: p.warn },
    empty: {
      alignItems: 'center',
      padding: 24,
      gap: 8,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 16,
      borderStyle: 'dashed',
      backgroundColor: p.card,
    },
    emptyTitle: { fontSize: 16, fontWeight: '700', color: p.text },
    emptyBody: { color: p.sub, textAlign: 'center' },
    tabBar: {
      flexDirection: 'row',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: p.border,
      backgroundColor: p.card,
      paddingHorizontal: 8,
      paddingTop: 8,
      gap: 4,
      shadowColor: '#0E3A47',
      shadowOffset: { width: 0, height: -3 },
      shadowOpacity: 0.08,
      shadowRadius: 10,
      elevation: 8,
    },
    tab: {
      flex: 1,
      minHeight: 56,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 16,
      paddingVertical: 8,
      paddingHorizontal: 2,
    },
    tabOn: { backgroundColor: p.accentSoft },
    tabLabel: { fontSize: 12, fontWeight: '600', color: p.sub, marginTop: 3 },
    tabLabelOn: { color: p.accent, fontWeight: '800' },
    tabDot: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: p.chipIdle,
    },
    tabDotOn: { backgroundColor: p.accent },
    tabDotText: { fontSize: 12, fontWeight: '800', color: p.sub },
    tabDotTextOn: { color: '#FFFFFF' },
    input: {
      backgroundColor: p.card,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 16,
      paddingHorizontal: 14,
      minHeight: 48,
      color: p.text,
      fontSize: 15,
    },
    inputError: { borderColor: p.danger },
    label: { fontSize: 13, fontWeight: '600', color: p.sub, marginBottom: 4 },
    errText: { color: p.danger, fontSize: 12, marginTop: 4 },
    fieldStack: { gap: 14, paddingBottom: 8 },
    notesInput: { minHeight: 80, textAlignVertical: 'top' },
    kindChip: { flexGrow: 0 },
    weekdayDot: {
      width: 44,
      height: 44,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    weekdayDotOn: { backgroundColor: p.accent, borderColor: p.accent },
    weekdayDotText: { color: p.text, fontWeight: '700' },
    weekdayDotTextOn: { color: '#FFFFFF' },
    kindRow: {
      minHeight: 44,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.card,
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    kindRowOn: { borderColor: p.accent, backgroundColor: p.accentSoft },
    kindText: { color: p.text, fontSize: 14, fontWeight: '600' },
    kindTextOn: { color: p.accent, fontWeight: '800' },
    appHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    headerDate: { color: p.sub, fontSize: 12, fontWeight: '600', marginTop: 2 },
    headerTitle: { color: p.text, fontSize: 15, fontWeight: '800' },
    headerRight: { alignItems: 'flex-end' },
    loadingGap: { gap: 14 },
    timeSummaryMain: { flex: 1 },
    timeAddBtn: { flex: 1.2 },
    timeErrorBox: { paddingHorizontal: 14, paddingBottom: 10 },
    timeBox: {
      backgroundColor: p.card,
      borderWidth: 1,
      borderColor: p.border,
      borderRadius: 16,
      overflow: 'hidden',
    },
    timeSummary: {
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      gap: 8,
    },
    timeSummaryText: { color: p.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    timeSummarySub: { color: p.sub, fontSize: 12, marginTop: 1 },
    chevron: { color: p.sub, fontSize: 16, fontWeight: '800' },
    timeBody: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.border, padding: 12, gap: 10 },
    timeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    timeCell: {
      minWidth: 58,
      minHeight: 40,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.chipIdle,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 8,
    },
    timeCellOn: { backgroundColor: p.accent, borderColor: p.accent },
    timeCellText: { color: p.text, fontSize: 14, fontWeight: '700' },
    timeCellTextOn: { color: '#FFFFFF' },
    timeAddRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    timeSelect: {
      flex: 1,
      minHeight: 46,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: p.border,
      backgroundColor: p.chipIdle,
      alignItems: 'center',
      justifyContent: 'center',
    },
    timeSelectText: { color: p.text, fontSize: 16, fontWeight: '800' },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(4,20,25,0.55)', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: p.bg,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      maxHeight: '92%',
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 44,
      height: 5,
      borderRadius: 3,
      backgroundColor: p.border,
      marginTop: 10,
      marginBottom: 4,
    },
    sheetHeader: { paddingHorizontal: 16, paddingBottom: 8 },
    sheetTitle: { fontSize: 20, fontWeight: '800', color: p.text },
    sheetBody: { paddingHorizontal: 16 },
    sheetFooter: { flexDirection: 'row', gap: 10, padding: 16 },
    footerBtn: { flex: 1 },
    toast: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 112,
      backgroundColor: p.hero,
      borderRadius: 16,
      paddingVertical: 12,
      paddingHorizontal: 16,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 10,
      elevation: 6,
    },
    toastText: { color: p.heroText, textAlign: 'center', fontSize: 13, fontWeight: '600' },
    medName: { fontSize: 16, fontWeight: '700', color: p.text, flexShrink: 1 },
    medDose: { color: p.sub, fontSize: 13, marginTop: 2 },
    medStock: { fontSize: 13, fontWeight: '700', color: p.text },
    stockWarn: { color: p.warn },
    stockBad: { color: p.danger },
    paused: { color: p.warn, fontSize: 12, fontWeight: '700' },
    activeTag: { color: p.ok, fontSize: 12, fontWeight: '700' },
    histRow: {
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: p.border,
      gap: 2,
    },
    histName: { fontSize: 15, fontWeight: '600', color: p.text },
    histMeta: { color: p.sub, fontSize: 12 },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
      gap: 10,
    },
    settingLabel: { color: p.text, fontSize: 15, fontWeight: '600' },
    settingSub: { color: p.sub, fontSize: 12, marginTop: 2 },
    linkBtn: { minHeight: 44, justifyContent: 'center' },
    linkText: { color: p.accent, fontWeight: '700', fontSize: 15 },
    note: { color: p.sub, fontSize: 12, lineHeight: 18 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: p.border, marginVertical: 8 },
    refillSheet: {
      backgroundColor: p.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 16,
      gap: 10,
    },
  });
}

function DoseCard(props: {
  row: DoseRow;
  now: number;
  busy: boolean;
  styles: TStyles;
  onTaken: () => void;
  onSkipped: () => void;
  onSnooze: () => void;
}): React.JSX.Element {
  const { row, now, busy, styles } = props;
  const late = row.dose === undefined && row.scheduledAt < now;
  const status = row.dose?.status;
  const pill =
    status === 'taken'
      ? styles.pillTaken
      : status === 'skipped'
        ? styles.pillSkipped
        : late
          ? styles.pillLate
          : null;
  const pillColor =
    status === 'taken'
      ? styles.textTaken
      : status === 'skipped'
        ? styles.textSkipped
        : late
          ? styles.textLate
          : null;
  const pillText = status !== undefined ? statusLabel(status) : late ? 'Atrasada' : 'Pendiente';
  const done = status !== undefined;
  return (
    <View style={styles.doseCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.doseName} numberOfLines={2}>
          {row.med.name}
        </Text>
        {pill !== null ? (
          <View style={[styles.statusPill, pill]}>
            <Text style={[styles.pillText, pillColor]}>{pillText}</Text>
          </View>
        ) : null}
      </View>
      <Text style={styles.doseMeta}>
        {fmtClock(row.scheduledAt)} · {row.med.dose} {row.med.unit}
        {row.med.strength.length > 0 ? ` · ${row.med.strength}` : ''}
      </Text>
      <View style={styles.rowGap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Marcar ${row.med.name} de las ${fmtClock(row.scheduledAt)} como tomada`}
          disabled={busy || done}
          onPress={props.onTaken}
          style={[
            styles.btn,
            styles.btnPrimary,
            styles.btnSmall,
            styles.btnFlex,
            busy || done ? styles.btnDisabled : null,
          ]}
        >
          <Text style={styles.btnTextPrimary}>Tomada</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Marcar ${row.med.name} de las ${fmtClock(row.scheduledAt)} como omitida`}
          disabled={busy || done}
          onPress={props.onSkipped}
          style={[styles.btn, styles.btnSmall, styles.btnFlex, busy || done ? styles.btnDisabled : null]}
        >
          <Text style={styles.btnText}>Omitir</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Posponer ${row.med.name} de las ${fmtClock(row.scheduledAt)} diez minutos`}
          disabled={busy}
          onPress={props.onSnooze}
          style={[styles.btn, styles.btnSmall, styles.btnFlex, busy ? styles.btnDisabled : null]}
        >
          <Text style={styles.btnText}>Posponer</Text>
        </Pressable>
      </View>
    </View>
  );
}

function MedCard(props: {
  med: Medication;
  now: number;
  styles: TStyles;
  onEdit: () => void;
  onRefill: () => void;
  onPauseToggle: () => void;
  onArchive: () => void;
}): React.JSX.Element {
  const { med, now, styles } = props;
  const ended = med.endAt !== undefined && med.endAt < now;
  const low = med.stock > 0 && med.stock <= med.lowStock;
  const out = med.stock <= 0;
  return (
    <View style={styles.card}>
      <View style={styles.rowBetween}>
        <Text style={styles.medName} numberOfLines={2}>
          {med.name}
        </Text>
        <Text style={med.active && !ended ? styles.activeTag : styles.paused}>
          {!med.active ? 'En pausa' : ended ? 'Finalizado' : 'Activo'}
        </Text>
      </View>
      <Text style={styles.medDose}>
        {med.dose} {med.unit}
        {med.strength.length > 0 ? ` · ${med.strength}` : ''} · {humanSchedule(med.schedule)}
      </Text>
      <Text style={[styles.medStock, out ? styles.stockBad : low ? styles.stockWarn : null]}>
        Stock: {med.stock} {med.unit}
        {out ? ' · Agotado' : low ? ' · Stock bajo' : ''}
      </Text>
      {med.notes.length > 0 ? <Text style={styles.medDose}>{med.notes}</Text> : null}
      <View style={styles.rowWrap}>
        <Pressable accessibilityRole="button" onPress={props.onEdit} style={[styles.chip]}>
          <Text style={styles.chipText}>Editar</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onRefill} style={[styles.chip]}>
          <Text style={styles.chipText}>Añadir stock</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={props.onPauseToggle} style={[styles.chip]}>
          <Text style={styles.chipText}>{med.active ? 'Pausar' : 'Reanudar'}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={props.onArchive}
          style={[styles.chip, styles.chipDanger]}
        >
          <Text style={[styles.chipText, styles.chipTextDanger]}>Archivar</Text>
        </Pressable>
      </View>
    </View>
  );
}

function HistoryRowItem(props: {
  medName: string;
  scheduledAt: number;
  recordedAt?: number;
  status?: Dose['status'];
  styles: TStyles;
}): React.JSX.Element {
  const { styles } = props;
  return (
    <View style={styles.histRow}>
      <View style={styles.rowBetween}>
        <Text style={styles.histName} numberOfLines={2}>
          {props.medName}
        </Text>
        <Text
          style={[
            styles.pillText,
            props.status === 'taken' ? styles.textTaken : styles.textSkipped,
          ]}
        >
          {props.status !== undefined ? statusLabel(props.status) : 'Pendiente'}
        </Text>
      </View>
      <Text style={styles.histMeta}>Programada: {fmtLocalDT(props.scheduledAt)}</Text>
      <Text style={styles.histMeta}>
        Registrada: {props.recordedAt !== undefined ? fmtLocalDT(props.recordedAt) : '—'}
      </Text>
    </View>
  );
}

function RefillModal(props: {
  med: Medication;
  value: string;
  busy: boolean;
  error: string | null;
  styles: TStyles;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  return (
    <Modal transparent animationType="slide" onRequestClose={props.onCancel}>
      <Pressable style={props.styles.modalBackdrop} onPress={props.onCancel}>
        <Pressable style={props.styles.refillSheet} onPress={undefined}>
          <View style={props.styles.sheetHandle} />
          <Text style={props.styles.sheetTitle}>Añadir stock</Text>
          <Text style={props.styles.sub}>
            {props.med.name} · ahora {props.med.stock} {props.med.unit}
          </Text>
          <TextInput
            style={[props.styles.input, props.error !== null ? props.styles.inputError : null]}
            value={props.value}
            onChangeText={props.onChange}
            keyboardType="decimal-pad"
            placeholder="Cantidad (p. ej. 30)"
            placeholderTextColor={props.styles.sub.color ?? '#888'}
            autoFocus
            accessibilityLabel="Cantidad de stock a añadir"
          />
          {props.error !== null ? <Text style={props.styles.errText}>{props.error}</Text> : null}
          <View style={props.styles.sheetFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={props.onCancel}
              style={[props.styles.btn, props.styles.footerBtn]}
            >
              <Text style={props.styles.btnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={props.onConfirm}
              disabled={props.busy}
              style={[
                props.styles.btn,
                props.styles.btnPrimary,
                props.styles.footerBtn,
                props.busy ? props.styles.btnDisabled : null,
              ]}
            >
              <Text style={props.styles.btnTextPrimary}>Añadir</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MedFormFields(props: {
  draft: MedDraft;
  onDraft: (patch: Partial<MedDraft>) => void;
  errors: Partial<Record<keyof MedDraft | 'form', string>>;
  styles: TStyles;
}): React.JSX.Element {
  const { draft, onDraft, errors, styles } = props;
  const isInterval = draft.kind === 'interval';
  const isWeekdays = draft.kind === 'weekdays';
  const isCycle = draft.kind === 'cycle';
  const errOf = (f: keyof MedDraft): string | null => errors[f] ?? null;
  return (
    <View style={styles.fieldStack}>
      <View>
        <Text style={styles.label}>Nombre *</Text>
        <TextInput
          style={[styles.input, errOf('name') !== null ? styles.inputError : null]}
          value={draft.name}
          onChangeText={(v) => onDraft({ name: v })}
          placeholder="p. ej. Metformina"
          placeholderTextColor={styles.sub.color ?? '#888'}
          accessibilityLabel="Nombre del medicamento"
        />
        {errOf('name') !== null ? <Text style={styles.errText}>{errOf('name')}</Text> : null}
      </View>
      <View>
        <Text style={styles.label}>Concentración (opcional)</Text>
        <TextInput
          style={styles.input}
          value={draft.strength}
          onChangeText={(v) => onDraft({ strength: v })}
          placeholder="p. ej. 850 mg"
          placeholderTextColor={styles.sub.color ?? '#888'}
          accessibilityLabel="Concentración"
        />
      </View>
      <View style={styles.rowGap}>
        <View style={styles.colFlex}>
          <Text style={styles.label}>Dosis por toma *</Text>
          <TextInput
            style={[styles.input, errOf('dose') !== null ? styles.inputError : null]}
            value={draft.dose}
            onChangeText={(v) => onDraft({ dose: v })}
            keyboardType="decimal-pad"
            accessibilityLabel="Dosis por toma"
          />
          {errOf('dose') !== null ? <Text style={styles.errText}>{errOf('dose')}</Text> : null}
        </View>
        <View style={styles.colFlex}>
          <Text style={styles.label}>Unidad *</Text>
          <View style={styles.rowWrap}>
            {UNITS.map((u) => (
              <Pressable
                key={u}
                accessibilityRole="button"
                accessibilityState={{ selected: draft.unit === u }}
                onPress={() => onDraft({ unit: u })}
                style={[styles.chip, draft.unit === u ? styles.chipOn : null]}
              >
                <Text style={[styles.chipText, draft.unit === u ? styles.chipTextOn : null]}>
                  {u}
                </Text>
              </Pressable>
            ))}
          </View>
          {errOf('unit') !== null ? <Text style={styles.errText}>{errOf('unit')}</Text> : null}
        </View>
      </View>
      <View style={styles.rowGap}>
        <View style={styles.colFlex}>
          <Text style={styles.label}>Stock actual *</Text>
          <TextInput
            style={[styles.input, errOf('stock') !== null ? styles.inputError : null]}
            value={draft.stock}
            onChangeText={(v) => onDraft({ stock: v })}
            keyboardType="decimal-pad"
            accessibilityLabel="Stock actual"
          />
          {errOf('stock') !== null ? <Text style={styles.errText}>{errOf('stock')}</Text> : null}
        </View>
        <View style={styles.colFlex}>
          <Text style={styles.label}>Aviso stock bajo *</Text>
          <TextInput
            style={[styles.input, errOf('lowStock') !== null ? styles.inputError : null]}
            value={draft.lowStock}
            onChangeText={(v) => onDraft({ lowStock: v })}
            keyboardType="decimal-pad"
            accessibilityLabel="Aviso de stock bajo"
          />
          {errOf('lowStock') !== null ? (
            <Text style={styles.errText}>{errOf('lowStock')}</Text>
          ) : null}
        </View>
      </View>
      <View>
        <Text style={styles.label}>Inicio *</Text>
        <TextInput
          style={[styles.input, errOf('startInput') !== null ? styles.inputError : null]}
          value={draft.startInput}
          onChangeText={(v) => onDraft({ startInput: v })}
          placeholder="AAAA-MM-DD HH:MM"
          placeholderTextColor={styles.sub.color ?? '#888'}
          autoCapitalize="none"
          accessibilityLabel="Fecha y hora de inicio, formato AAAA-MM-DD HH:MM"
        />
        {errOf('startInput') !== null ? (
          <Text style={styles.errText}>{errOf('startInput')}</Text>
        ) : null}
      </View>
      <View>
        <Text style={styles.label}>Fin (opcional)</Text>
        <TextInput
          style={[styles.input, errOf('endInput') !== null ? styles.inputError : null]}
          value={draft.endInput}
          onChangeText={(v) => onDraft({ endInput: v })}
          placeholder="AAAA-MM-DD HH:MM"
          placeholderTextColor={styles.sub.color ?? '#888'}
          autoCapitalize="none"
          accessibilityLabel="Fecha y hora de fin, formato AAAA-MM-DD HH:MM"
        />
        {errOf('endInput') !== null ? <Text style={styles.errText}>{errOf('endInput')}</Text> : null}
      </View>
      <View>
        <Text style={styles.label}>Tipo de horario</Text>
        <View style={styles.rowWrap}>
          {KIND_OPTIONS.map((opt) => (
            <Pressable
              key={opt.kind}
              accessibilityRole="button"
              accessibilityState={{ selected: draft.kind === opt.kind }}
              onPress={() => onDraft({ kind: opt.kind })}
              style={[styles.chip, draft.kind === opt.kind ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, draft.kind === opt.kind ? styles.chipTextOn : null]}>
                {opt.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View>
        <Text style={styles.label}>
          {isInterval ? 'Ancla inicial (opcional) *' : 'Horas de toma *'}
        </Text>
        <TimesEditor
          value={draft.times}
          single={isInterval}
          error={errOf('times')}
          styles={styles}
          onChange={(v) => onDraft({ times: v })}
        />
      </View>
      {isInterval ? (
        <View>
          <Text style={styles.label}>Intervalo en horas *</Text>
          <TextInput
            style={[styles.input, errOf('intervalHours') !== null ? styles.inputError : null]}
            value={draft.intervalHours}
            onChangeText={(v) => onDraft({ intervalHours: v })}
            keyboardType="decimal-pad"
            accessibilityLabel="Intervalo en horas"
          />
          {errOf('intervalHours') !== null ? (
            <Text style={styles.errText}>{errOf('intervalHours')}</Text>
          ) : null}
        </View>
      ) : null}
      {isWeekdays ? (
        <View>
          <Text style={styles.label}>Días de la semana *</Text>
          <View style={styles.rowBetween}>
            {WEEKDAY_SHORT.map((label, idx) => {
              const on = draft.weekdays.includes(idx);
              return (
                <Pressable
                  key={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={WEEKDAY_FULL[idx]}
                  onPress={() =>
                    onDraft({
                      weekdays: on
                        ? draft.weekdays.filter((d) => d !== idx)
                        : [...draft.weekdays, idx].sort((a, b) => a - b),
                    })
                  }
                  style={[styles.weekdayDot, on ? styles.weekdayDotOn : null]}
                >
                  <Text style={[styles.weekdayDotText, on ? styles.weekdayDotTextOn : null]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {errOf('weekdays') !== null ? (
            <Text style={styles.errText}>{errOf('weekdays')}</Text>
          ) : null}
        </View>
      ) : null}
      {isCycle ? (
        <View style={styles.rowGap}>
          <View style={styles.colFlex}>
            <Text style={styles.label}>Días activos *</Text>
            <TextInput
              style={[styles.input, errOf('activeDays') !== null ? styles.inputError : null]}
              value={draft.activeDays}
              onChangeText={(v) => onDraft({ activeDays: v })}
              keyboardType="number-pad"
              accessibilityLabel="Días activos del ciclo"
            />
            {errOf('activeDays') !== null ? (
              <Text style={styles.errText}>{errOf('activeDays')}</Text>
            ) : null}
          </View>
          <View style={styles.colFlex}>
            <Text style={styles.label}>Días de descanso *</Text>
            <TextInput
              style={[styles.input, errOf('restDays') !== null ? styles.inputError : null]}
              value={draft.restDays}
              onChangeText={(v) => onDraft({ restDays: v })}
              keyboardType="number-pad"
              accessibilityLabel="Días de descanso del ciclo"
            />
            {errOf('restDays') !== null ? (
              <Text style={styles.errText}>{errOf('restDays')}</Text>
            ) : null}
          </View>
        </View>
      ) : null}
      <View>
        <Text style={styles.label}>Notas (opcional)</Text>
        <TextInput
          style={[styles.input, styles.notesInput]}
          value={draft.notes}
          onChangeText={(v) => onDraft({ notes: v })}
          multiline
          placeholder="Instrucciones, alergias, etc."
          placeholderTextColor={styles.sub.color ?? '#888'}
          accessibilityLabel="Notas"
        />
      </View>
      {errors.form !== undefined ? <Text style={styles.errText}>{errors.form}</Text> : null}
    </View>
  );
}

function MedFormModal(props: {
  mode: 'create' | 'edit';
  draft: MedDraft;
  errors: Partial<Record<keyof MedDraft | 'form', string>>;
  busy: boolean;
  styles: TStyles;
  onDraft: (patch: Partial<MedDraft>) => void;
  onClose: () => void;
  onSave: () => void;
}): React.JSX.Element {
  return (
    <Modal transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={props.styles.modalBackdrop}>
        <View style={props.styles.sheet}>
          <View style={props.styles.sheetHandle} />
          <View style={props.styles.sheetHeader}>
            <Text style={props.styles.sheetTitle}>
              {props.mode === 'create' ? 'Nuevo medicamento' : 'Editar medicamento'}
            </Text>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={props.styles.sheetBody}>
            <MedFormFields
              draft={props.draft}
              onDraft={props.onDraft}
              errors={props.errors}
              styles={props.styles}
            />
          </ScrollView>
          <View style={props.styles.sheetFooter}>
            <Pressable
              accessibilityRole="button"
              onPress={props.onClose}
              style={[props.styles.btn, props.styles.footerBtn]}
            >
              <Text style={props.styles.btnText}>Cancelar</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={props.onSave}
              disabled={props.busy}
              style={[
                props.styles.btn,
                props.styles.btnPrimary,
                props.styles.footerBtn,
                props.busy ? props.styles.btnDisabled : null,
              ]}
            >
              <Text style={props.styles.btnTextPrimary}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const TAB_SHORT: Record<TabKey, string> = {
  hoy: 'H',
  meds: 'M',
  historial: 'R',
  ajustes: 'A',
};

function Tabs(props: {
  tab: TabKey;
  styles: TStyles;
  bottomInset: number;
  onChange: (t: TabKey) => void;
}): React.JSX.Element {
  return (
    <View style={[props.styles.tabBar, { paddingBottom: Math.max(props.bottomInset, 10) }]}>
      {TABS.map((t) => {
        const on = props.tab === t.key;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            onPress={() => props.onChange(t.key)}
            style={[props.styles.tab, on ? props.styles.tabOn : null]}
          >
            <View style={[props.styles.tabDot, on ? props.styles.tabDotOn : null]}>
              <Text style={[props.styles.tabDotText, on ? props.styles.tabDotTextOn : null]}>
                {TAB_SHORT[t.key]}
              </Text>
            </View>
            <Text
              style={[props.styles.tabLabel, on ? props.styles.tabLabelOn : null]}
              numberOfLines={1}
            >
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function AppHeader(props: {
  styles: TStyles;
  title: string;
  subtitle: string;
  brandTitle: string;
  brandSub: string;
}): React.JSX.Element {
  return (
    <View style={props.styles.appHeader}>
      <Logo size="small" compact titleColor={props.brandTitle} subtitleColor={props.brandSub} />
      <View style={props.styles.headerRight}>
        <Text style={props.styles.headerTitle}>{props.title}</Text>
        <Text style={props.styles.headerDate}>{props.subtitle}</Text>
      </View>
    </View>
  );
}

function TimesEditor(props: {
  value: string;
  single: boolean;
  error: string | null;
  styles: TStyles;
  onChange: (v: string) => void;
}): React.JSX.Element {
  const { styles } = props;
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState(8);
  const [minute, setMinute] = useState(0);
  const times = useMemo(() => parseTimesInput(props.value) ?? [], [props.value]);
  const summary = times.length === 0 ? 'Sin horas' : times.join(', ');
  const sub = props.single
    ? 'Toca para elegir el ancla (opcional)'
    : `${times.length} hora(s) · toca para editar`;
  const togglePreset = (t: string): void => {
    if (props.single) {
      props.onChange(t);
      return;
    }
    const set = new Set(times);
    if (set.has(t)) {
      set.delete(t);
    } else {
      set.add(t);
    }
    props.onChange([...set].sort().join(', '));
  };
  const addCustom = (): void => {
    const t = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    if (props.single) {
      props.onChange(t);
      return;
    }
    const set = new Set(times);
    set.add(t);
    props.onChange([...set].sort().join(', '));
  };
  const removeAt = (t: string): void => {
    props.onChange(times.filter((x) => x !== t).join(', '));
  };
  return (
    <View style={styles.timeBox}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={props.single ? 'Elegir hora de ancla' : 'Editar horas de toma'}
        onPress={() => setOpen((v) => !v)}
        style={styles.timeSummary}
      >
        <View style={styles.timeSummaryMain}>
          <Text style={styles.timeSummaryText} numberOfLines={1}>
            {summary}
          </Text>
          <Text style={styles.timeSummarySub}>{sub}</Text>
        </View>
        <Text style={styles.chevron}>{open ? '▴' : '▾'}</Text>
      </Pressable>
      {open ? (
        <View style={styles.timeBody}>
          <View style={styles.timeGrid}>
            {['08:00', '09:00', '12:00', '14:00', '18:00', '20:00', '21:00', '22:00'].map((t) => {
              const on = times.includes(t);
              return (
                <Pressable
                  key={t}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => togglePreset(t)}
                  style={[styles.timeCell, on ? styles.timeCellOn : null]}
                >
                  <Text style={[styles.timeCellText, on ? styles.timeCellTextOn : null]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.timeAddRow}>
            <Pressable
              accessibilityLabel="Hora"
              onPress={() => setHour((h) => (h + 1) % 24)}
              style={styles.timeSelect}
            >
              <Text style={styles.timeSelectText}>{String(hour).padStart(2, '0')} h</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Minutos"
              onPress={() => setMinute((m) => (m + 5) % 60)}
              style={styles.timeSelect}
            >
              <Text style={styles.timeSelectText}>{String(minute).padStart(2, '0')} min</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Añadir hora"
              onPress={addCustom}
              style={[styles.btn, styles.btnPrimary, styles.timeAddBtn]}
            >
              <Text style={styles.btnTextPrimary}>Añadir</Text>
            </Pressable>
          </View>
          <View style={styles.timeGrid}>
            {times.map((t) => (
              <Pressable
                key={t}
                accessibilityRole="button"
                accessibilityLabel={`Quitar ${t}`}
                onPress={() => removeAt(t)}
                style={[styles.timeCell, styles.timeCellOn]}
              >
                <Text style={[styles.timeCellText, styles.timeCellTextOn]}>{t} ✕</Text>
              </Pressable>
            ))}
          </View>
          {times.length === 0 && !props.single ? (
            <Text style={styles.sub}>Añade al menos una hora con los accesos rápidos o el selector.</Text>
          ) : null}
          {props.error !== null ? <Text style={styles.errText}>{props.error}</Text> : null}
          <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={[styles.btn]}>
            <Text style={styles.btnText}>Listo</Text>
          </Pressable>
        </View>
      ) : props.error !== null ? (
        <View style={styles.timeErrorBox}>
          <Text style={styles.errText}>{props.error}</Text>
        </View>
      ) : null}
    </View>
  );
}

function TodayTab(props: {
  state: AppState;
  now: number;
  busy: boolean;
  styles: TStyles;
  doseActions: DoseActions;
  onCreate: () => void;
}): React.JSX.Element {
  const { state, now, busy, styles, doseActions } = props;
  const dayStart = startOfToday();
  const dayEnd = dayStart + MS_PER_DAY - 1;
  const rows = buildDoseRows(state.medications, state.doses, dayStart, dayEnd);
  const taken = rows.filter((r) => r.dose?.status === 'taken').length;
  const recorded = rows.filter((r) => r.dose !== undefined).length;
  const pct = rows.length === 0 ? 0 : Math.round((taken / rows.length) * 100);
  const activeCount = state.medications.filter((m) => m.active).length;
  const overdue = rows.filter((r) => r.dose === undefined && r.scheduledAt < now).length;
  return (
    <>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Adherencia de hoy</Text>
        <Text style={styles.heroPct}>{pct}%</Text>
        <Text style={styles.heroSub}>
          {taken} de {rows.length} tomas registradas · {activeCount} medicamento(s) activo(s)
        </Text>
        <View style={styles.heroBar}>
          <View style={[styles.heroBarFill, { width: `${pct}%` }]} />
        </View>
      </View>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Sin tomas hoy</Text>
          <Text style={styles.emptyBody}>
            No hay tomas programadas para hoy. Añade un medicamento para empezar.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={props.onCreate}
            style={[styles.btn, styles.btnPrimary]}
          >
            <Text style={styles.btnTextPrimary}>Añadir medicamento</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <Text style={styles.h2}>Tomas de hoy</Text>
          {overdue > 0 ? (
            <Text style={styles.sub}>{overdue} toma(s) pendiente(s) fuera de hora.</Text>
          ) : null}
          {rows.map((r) => (
            <DoseCard
              key={`${r.med.id}:${r.scheduledAt}`}
              row={r}
              now={now}
              busy={busy}
              styles={styles}
              onTaken={() => doseActions.markTaken(r.med, r.scheduledAt)}
              onSkipped={() => doseActions.markSkipped(r.med, r.scheduledAt)}
              onSnooze={() => doseActions.snoozeDose(r.med, r.scheduledAt)}
            />
          ))}
          <Text style={styles.sub}>
            {recorded} de {rows.length} tomas con registro.
          </Text>
        </>
      )}
    </>
  );
}

function MedsTab(props: {
  state: AppState;
  now: number;
  styles: TStyles;
  onEdit: (med: Medication) => void;
  onRefill: (med: Medication) => void;
  onPauseToggle: (med: Medication) => void;
  onArchive: (med: Medication) => void;
  onCreate: () => void;
}): React.JSX.Element {
  const { state, styles } = props;
  const meds = state.medications;
  return (
    <>
      <View style={styles.rowBetween}>
        <Text style={styles.h2}>Mis medicamentos</Text>
        <Pressable accessibilityRole="button" onPress={props.onCreate} style={styles.chip}>
          <Text style={styles.chipText}>Añadir</Text>
        </Pressable>
      </View>
      {meds.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Sin medicamentos</Text>
          <Text style={styles.emptyBody}>
            Añade tu primer medicamento con su horario para empezar a registrar tomas.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={props.onCreate}
            style={[styles.btn, styles.btnPrimary]}
          >
            <Text style={styles.btnTextPrimary}>Añadir medicamento</Text>
          </Pressable>
        </View>
      ) : (
        meds.map((med) => (
          <MedCard
            key={med.id}
            med={med}
            now={props.now}
            styles={styles}
            onEdit={() => props.onEdit(med)}
            onRefill={() => props.onRefill(med)}
            onPauseToggle={() => props.onPauseToggle(med)}
            onArchive={() => props.onArchive(med)}
          />
        ))
      )}
    </>
  );
}

function HistoryTab(props: {
  state: AppState;
  styles: TStyles;
  filter: HistoryFilter;
  onFilter: (f: HistoryFilter) => void;
}): React.JSX.Element {
  const { state, styles } = props;
  const rows = state.doses
    .filter((d) => props.filter === 'all' || d.status === props.filter)
    .map((d) => {
      const med = state.medications.find((m) => m.id === d.medicationId);
      return { dose: d, medName: med !== undefined ? med.name : d.medicationId };
    })
    .sort((a, b) => b.dose.scheduledAt - a.dose.scheduledAt)
    .slice(0, 200);
  return (
    <>
      <Text style={styles.h2}>Historial</Text>
      <View style={styles.rowWrap}>
        {(
          [
            { key: 'all', label: 'Todas' },
            { key: 'taken', label: 'Tomadas' },
            { key: 'skipped', label: 'Omitidas' },
          ] as const
        ).map((f) => (
          <Pressable
            key={f.key}
            accessibilityRole="button"
            accessibilityState={{ selected: props.filter === f.key }}
            onPress={() => props.onFilter(f.key)}
            style={[styles.chip, props.filter === f.key ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, props.filter === f.key ? styles.chipTextOn : null]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>
      {rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Sin registros</Text>
          <Text style={styles.emptyBody}>
            Aquí verás las tomas que registres, con la fecha programada y la fecha real.
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          {rows.map((r) => (
            <HistoryRowItem
              key={r.dose.id}
              medName={r.medName}
              scheduledAt={r.dose.scheduledAt}
              recordedAt={r.dose.recordedAt}
              status={r.dose.status}
              styles={styles}
            />
          ))}
        </View>
      )}
    </>
  );
}

function SettingsTab(props: {
  state: AppState;
  styles: TStyles;
  busy: boolean;
  onTheme: (t: ThemeChoice) => void;
  onRequestPermission: () => void;
  onResync: () => void;
  onOpenSettings: () => void;
  onExport: () => void;
}): React.JSX.Element {
  const { styles } = props;
  return (
    <>
      <Text style={styles.h2}>Ajustes</Text>
      <View style={styles.card}>
        <Text style={styles.settingLabel}>Apariencia</Text>
        <View style={styles.rowWrap}>
          {(
            [
              { key: 'system', label: 'Sistema' },
              { key: 'light', label: 'Claro' },
              { key: 'dark', label: 'Oscuro' },
            ] as const
          ).map((t) => (
            <Pressable
              key={t.key}
              accessibilityRole="button"
              accessibilityState={{ selected: props.state.theme === t.key }}
              onPress={() => props.onTheme(t.key)}
              style={[styles.chip, props.state.theme === t.key ? styles.chipOn : null]}
            >
              <Text style={[styles.chipText, props.state.theme === t.key ? styles.chipTextOn : null]}>
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.card}>
        <View style={styles.settingRow}>
          <View style={styles.colFlex}>
            <Text style={styles.settingLabel}>Notificaciones</Text>
            <Text style={styles.settingSub}>
              Solicita o revisa el permiso de notificaciones del sistema.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={props.onRequestPermission}
            disabled={props.busy}
            style={[styles.btn, styles.btnSmall, props.busy ? styles.btnDisabled : null]}
          >
            <Text style={styles.btnText}>Solicitar</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />
        <View style={styles.settingRow}>
          <View style={styles.colFlex}>
            <Text style={styles.settingLabel}>Resincronizar recordatorios</Text>
            <Text style={styles.settingSub}>
              Reprograma hasta 50 recordatorios de los próximos 7 días.
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={props.onResync}
            disabled={props.busy}
            style={[styles.btn, styles.btnSmall, props.busy ? styles.btnDisabled : null]}
          >
            <Text style={styles.btnText}>Sincronizar</Text>
          </Pressable>
        </View>
        <View style={styles.divider} />
        <Pressable accessibilityRole="button" onPress={props.onOpenSettings} style={styles.linkBtn}>
          <Text style={styles.linkText}>Abrir ajustes del sistema</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.settingLabel}>Informe personal</Text>
        <Text style={styles.note}>
          Genera un PDF con tus medicamentos y tomas registradas. Contiene datos personales:
          compártelo solo con quien tú decidas.
        </Text>
        <View style={styles.gapSm} />
        <Pressable
          accessibilityRole="button"
          onPress={props.onExport}
          disabled={props.busy}
          style={[styles.btn, styles.btnSmall, styles.selfStart, props.busy ? styles.btnDisabled : null]}
        >
          <Text style={styles.btnText}>Exportar informe</Text>
        </Pressable>
      </View>
      <View style={styles.card}>
        <Text style={styles.settingLabel}>Acerca de los recordatorios</Text>
        <Text style={styles.note}>
          Se programan hasta 50 recordatorios para los próximos 7 días y se resincronizan al abrir
          la app; las tomas con más de 7 días pueden no tener recordatorio. En Android, si fuerzas
          el cierre o el sistema optimiza la batería, los recordatorios pueden retrasarse; excluye
          MediRecord de la optimización de batería para mayor fiabilidad.
        </Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.settingLabel}>Aviso importante</Text>
        <Text style={styles.note}>
          MediRecord es un registro personal de medicación. No es un dispositivo médico y no ofrece
          consejos médicos. Para cualquier duda sobre tu tratamiento, consulta a un profesional
          sanitario.
        </Text>
      </View>
    </>
  );
}

function AppRoot({ systemScheme }: { systemScheme: 'light' | 'dark' }): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<TabKey>('hoy');
  const [form, setForm] = useState<{ mode: 'create' | 'edit'; med?: Medication } | null>(null);
  const [draft, setDraft] = useState<MedDraft | null>(null);
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof MedDraft | 'form', string>>>({});
  const [refill, setRefill] = useState<Medication | null>(null);
  const [refillQty, setRefillQty] = useState('');
  const [refillError, setRefillError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const palette =
    state === null
      ? systemScheme === 'dark'
        ? DARK
        : LIGHT
      : state.theme === 'dark'
        ? DARK
        : state.theme === 'light'
          ? LIGHT
          : systemScheme === 'dark'
            ? DARK
            : LIGHT;
  const styles = useMemo(() => makeStyles(palette), [palette]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const s = await loadState();
      setState(s);
    } catch {
      setToast('No se pudieron cargar los datos.');
    }
  }, []);

  const guard = useCallback(
    async (fn: () => Promise<void>, okMsg?: string): Promise<void> => {
      if (busy) {
        return;
      }
      setBusy(true);
      try {
        await fn();
        if (okMsg !== undefined) {
          setToast(okMsg);
        }
      } catch (e) {
        setToast(humanError(e));
      } finally {
        setBusy(false);
        void refresh();
      }
    },
    [busy, refresh],
  );

  const doseActions = useMemo<DoseActions>(
    () => ({
      markTaken: (med, scheduledAt) => {
        if (busy) {
          return;
        }
        Alert.alert(
          'Marcar toma',
          `¿Registrar ${med.name} de las ${fmtClock(scheduledAt)} como tomada?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Tomada',
              style: 'default',
              onPress: () => {
                void guard(async () => {
                  await recordDose(med.id, scheduledAt, 'taken');
                }, 'Toma registrada.');
              },
            },
          ],
        );
      },
      markSkipped: (med, scheduledAt) => {
        if (busy) {
          return;
        }
        Alert.alert(
          'Omitir toma',
          `¿Registrar ${med.name} de las ${fmtClock(scheduledAt)} como omitida?`,
          [
            { text: 'Cancelar', style: 'cancel' },
            {
              text: 'Omitir',
              style: 'destructive',
              onPress: () => {
                void guard(async () => {
                  await recordDose(med.id, scheduledAt, 'skipped');
                }, 'Toma omitida registrada.');
              },
            },
          ],
        );
      },
      snoozeDose: (med, scheduledAt) => {
        void guard(async () => {
          await snooze(med.id, scheduledAt);
        }, 'Recordatorio pospuesto 10 minutos.');
      },
    }),
    [busy, guard],
  );

  useEffect(() => {
    void refresh();
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const stop = notifee.onForegroundEvent((event) => {
      void (async () => {
        try {
          await handleNotificationEvent(event);
        } catch {
          setToast('No se pudo procesar la acción de la notificación.');
        }
        void refresh();
      })();
    });
    return () => stop();
  }, [refresh]);

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (st) => {
      if (st === 'active') {
        setNow(Date.now());
        void refresh();
        void (async () => {
          try {
            await syncNotifications();
          } catch {
            setToast('No se pudo resincronizar recordatorios.');
          }
        })();
      }
    });
    return () => sub.remove();
  }, [refresh]);

  useEffect(() => {
    if (toast === null) {
      return;
    }
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  const applyTheme = useCallback(
    (choice: ThemeChoice): void => {
      setState((prev) => (prev !== null ? { ...prev, theme: choice } : prev));
      void setTheme(choice).catch(() => {
        setToast('No se pudo guardar el tema.');
      });
    },
    [],
  );

  const openMedForm = useCallback((mode: 'create' | 'edit', med?: Medication): void => {
    setForm({ mode, med });
    setDraft(makeDraft(med));
    setFormErrors({});
  }, []);

  const closeMedForm = useCallback((): void => {
    setForm(null);
    setDraft(null);
    setFormErrors({});
  }, []);

  const saveMed = useCallback((): void => {
    if (draft === null || form === null) {
      return;
    }
    try {
      const med = buildMedication(draft, form.med);
      void guard(async () => {
        await saveMedication(med);
      }, 'Medicamento guardado.');
      closeMedForm();
    } catch (e) {
      if (e instanceof FormError) {
        setFormErrors({ [e.field]: e.message });
      } else {
        setFormErrors({ form: humanError(e) });
      }
    }
  }, [draft, form, guard, closeMedForm]);

  const requestPermissionAction = useCallback((): void => {
    void guard(async () => {
      const granted = await requestNotifications();
      if (granted) {
        setToast('Notificaciones activadas.');
      } else {
        setToast('Permiso de notificaciones no concedido.');
      }
    });
  }, [guard]);

  const resyncAction = useCallback((): void => {
    void guard(async () => {
      await syncNotifications();
    }, 'Recordatorios resincronizados.');
  }, [guard]);

  const openOsSettingsAction = useCallback((): void => {
    void Linking.openSettings();
  }, []);

  const exportAction = useCallback((): void => {
    Alert.alert(
      'Exportar informe',
      'Se generará un PDF con tus datos personales de medicación (nombres, dosis, horarios e historial de tomas) y se abrirá para compartirlo.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Exportar',
          onPress: () => {
            void guard(async () => {
              await exportReport();
            }, 'Informe generado.');
          },
        },
      ],
    );
  }, [guard]);

  const archiveAction = useCallback(
    (med: Medication): void => {
      Alert.alert(
        'Archivar medicamento',
        `Se archivará ${med.name} y dejará de generar recordatorios. Su historial se conserva.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Archivar',
            style: 'destructive',
            onPress: () => {
              void guard(async () => {
                await deleteMedication(med.id);
              }, 'Medicamento archivado.');
            },
          },
        ],
      );
    },
    [guard],
  );

  const pauseToggleAction = useCallback(
    (med: Medication): void => {
      const next = !med.active;
      Alert.alert(
        next ? 'Reanudar medicamento' : 'Pausar medicamento',
        next
          ? `Volverán a generarse tomas y recordatorios de ${med.name}.`
          : `Se pausarán las tomas y recordatorios de ${med.name}.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: next ? 'Reanudar' : 'Pausar',
            onPress: () => {
              void guard(async () => {
                await saveMedication({ ...med, active: next });
              }, next ? 'Medicamento reanudado.' : 'Medicamento pausado.');
            },
          },
        ],
      );
    },
    [guard],
  );

  const refillOpen = useCallback((med: Medication): void => {
    setRefill(med);
    setRefillQty('');
    setRefillError(null);
  }, []);

  const refillConfirm = useCallback((): void => {
    if (refill === null) {
      return;
    }
    const qty = parseNumStrict(refillQty);
    if (qty === undefined || qty <= 0) {
      setRefillError('Escribe una cantidad mayor que cero.');
      return;
    }
    setRefillError(null);
    void guard(async () => {
      await addStock(refill.id, qty);
    }, 'Stock actualizado.');
    setRefill(null);
    setRefillQty('');
  }, [guard, refill, refillQty]);

  const insets = useSafeAreaInsets();

  if (state === null) {
    return (
      <View style={[styles.safe, styles.center, styles.loadingGap]}>
        <Logo size="large" />
        <ActivityIndicator color={palette.accent} />
        <Text style={styles.loadingText}>Cargando…</Text>
      </View>
    );
  }

  const headerTitle = tab === 'hoy' ? 'Hoy' : tab === 'meds' ? 'Medicamentos' : tab === 'historial' ? 'Historial' : 'Ajustes';
  const headerDate = new Date(now).toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <View
      style={styles.safe}
      onLayout={undefined}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={busy}
            onRefresh={() => {
              void refresh();
              void (async () => {
                try {
                  await syncNotifications();
                } catch {
                  setToast('No se pudo resincronizar recordatorios.');
                }
              })();
            }}
            tintColor={palette.accent}
            colors={[palette.accent]}
          />
        }
      >
        <AppHeader
          styles={styles}
          title={headerTitle}
          subtitle={headerDate}
          brandTitle={palette.text}
          brandSub={palette.sub}
        />
        {tab === 'hoy' ? (
          <TodayTab
            state={state}
            now={now}
            busy={busy}
            styles={styles}
            doseActions={doseActions}
            onCreate={() => openMedForm('create')}
          />
        ) : null}
        {tab === 'meds' ? (
          <MedsTab
            state={state}
            now={now}
            styles={styles}
            onEdit={(med) => openMedForm('edit', med)}
            onRefill={refillOpen}
            onPauseToggle={pauseToggleAction}
            onArchive={archiveAction}
            onCreate={() => openMedForm('create')}
          />
        ) : null}
        {tab === 'historial' ? (
          <HistoryTab
            state={state}
            styles={styles}
            filter={historyFilter}
            onFilter={setHistoryFilter}
          />
        ) : null}
        {tab === 'ajustes' ? (
          <SettingsTab
            state={state}
            styles={styles}
            busy={busy}
            onTheme={applyTheme}
            onRequestPermission={requestPermissionAction}
            onResync={resyncAction}
            onOpenSettings={openOsSettingsAction}
            onExport={exportAction}
          />
        ) : null}
      </ScrollView>
      <Tabs tab={tab} styles={styles} bottomInset={insets.bottom} onChange={setTab} />
      {toast !== null ? (
        <View style={styles.toast} accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
      {form !== null && draft !== null ? (
        <MedFormModal
          mode={form.mode}
          draft={draft}
          errors={formErrors}
          busy={busy}
          styles={styles}
          onDraft={(patch) => setDraft((prev) => (prev !== null ? { ...prev, ...patch } : prev))}
          onClose={closeMedForm}
          onSave={saveMed}
        />
      ) : null}
      {refill !== null ? (
        <RefillModal
          med={refill}
          value={refillQty}
          busy={busy}
          error={refillError}
          styles={styles}
          onChange={(v) => {
            setRefillQty(v);
            setRefillError(null);
          }}
          onCancel={() => {
            setRefill(null);
            setRefillQty('');
          }}
          onConfirm={refillConfirm}
        />
      ) : null}
    </View>
  );
}

export { AppRoot };

