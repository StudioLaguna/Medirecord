import { open, type DB, type Scalar } from '@op-engineering/op-sqlite';
import {
  validateMedication,
  type AppState,
  type Dose,
  type Medication,
} from './domain';

const DB_NAME = 'medirecord.db';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS medications (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  strength TEXT NOT NULL,
  dose REAL NOT NULL,
  unit TEXT NOT NULL,
  stock REAL NOT NULL,
  low_stock REAL NOT NULL,
  notes TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER,
  active INTEGER NOT NULL,
  schedule_json TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doses (
  id TEXT PRIMARY KEY NOT NULL,
  medication_id TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  recorded_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  UNIQUE(medication_id, scheduled_at)
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;

let dbPromise: Promise<DB> | null = null;

function getDb(): Promise<DB> {
  if (!dbPromise) {
    dbPromise = Promise.resolve().then(() => {
      const db = open({ name: DB_NAME });
      db.executeSync(SCHEMA);
      return db;
    });
  }
  return dbPromise;
}

function rowToMedication(row: Record<string, Scalar>): Medication {
  return {
    id: String(row.id),
    name: String(row.name),
    strength: String(row.strength),
    dose: Number(row.dose),
    unit: String(row.unit),
    stock: Number(row.stock),
    lowStock: Number(row.low_stock),
    notes: String(row.notes),
    startAt: Number(row.start_at),
    endAt: row.end_at === null || row.end_at === undefined ? undefined : Number(row.end_at),
    active: Number(row.active) === 1,
    schedule: JSON.parse(String(row.schedule_json)),
  };
}

function rowToDose(row: Record<string, Scalar>): Dose {
  return {
    id: String(row.id),
    medicationId: String(row.medication_id),
    scheduledAt: Number(row.scheduled_at),
    recordedAt: Number(row.recorded_at),
    status: row.status === 'taken' ? 'taken' : 'skipped',
  };
}

export async function loadState(): Promise<AppState> {
  const db = await getDb();
  const medRes = await db.execute(
    'SELECT * FROM medications WHERE archived = 0 ORDER BY name ASC, id ASC',
  );
  const doseRes = await db.execute(
    'SELECT * FROM doses ORDER BY scheduled_at ASC, id ASC',
  );
  const themeRes = await db.execute(
    "SELECT value FROM app_settings WHERE key = 'theme'",
  );
  const themeRow = themeRes.rows[0]?.value;
  const theme = themeRow === 'light' || themeRow === 'dark' ? themeRow : 'system';
  return {
    medications: medRes.rows.map(rowToMedication),
    doses: doseRes.rows.map(rowToDose),
    theme,
  };
}

export async function saveMedication(med: Medication): Promise<void> {
  validateMedication(med);
  const db = await getDb();
  await db.execute(
    `INSERT INTO medications
      (id, name, strength, dose, unit, stock, low_stock, notes, start_at, end_at, active, schedule_json, archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      strength = excluded.strength,
      dose = excluded.dose,
      unit = excluded.unit,
      stock = excluded.stock,
      low_stock = excluded.low_stock,
      notes = excluded.notes,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      active = excluded.active,
      schedule_json = excluded.schedule_json,
      archived = 0`,
    [
      med.id,
      med.name,
      med.strength,
      med.dose,
      med.unit,
      med.stock,
      med.lowStock,
      med.notes,
      med.startAt,
      med.endAt === undefined ? null : med.endAt,
      med.active ? 1 : 0,
      JSON.stringify(med.schedule),
    ],
  );
}

export async function deleteMedication(id: string): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('deleteMedication requires a non-empty medication id');
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const existing = await tx.execute(
      'SELECT id FROM medications WHERE id = ? AND archived = 0',
      [id],
    );
    if (existing.rows.length === 0) {
      throw new Error(`Medication ${id} not found or already archived`);
    }
    await tx.execute('UPDATE medications SET active = 0, archived = 1 WHERE id = ?', [id]);
  });
}

export async function recordDose(
  medicationId: string,
  scheduledAt: number,
  status: 'taken' | 'skipped',
): Promise<void> {
  if (typeof medicationId !== 'string' || medicationId.length === 0) {
    throw new Error('recordDose requires a non-empty medication id');
  }
  if (typeof scheduledAt !== 'number' || !Number.isFinite(scheduledAt)) {
    throw new Error('recordDose requires a finite scheduledAt timestamp');
  }
  if (status !== 'taken' && status !== 'skipped') {
    throw new Error('recordDose status must be taken or skipped');
  }
  const db = await getDb();
  await db.transaction(async (tx) => {
    const medRes = await tx.execute(
      'SELECT stock FROM medications WHERE id = ? AND archived = 0',
      [medicationId],
    );
    const medRow = medRes.rows[0];
    if (!medRow) {
      throw new Error(`Medication ${medicationId} not found`);
    }
    const dupe = await tx.execute(
      'SELECT id FROM doses WHERE medication_id = ? AND scheduled_at = ?',
      [medicationId, scheduledAt],
    );
    if (dupe.rows.length > 0) {
      return;
    }
    await tx.execute(
      `INSERT INTO doses (id, medication_id, scheduled_at, recorded_at, status)
       VALUES (?, ?, ?, ?, ?)`,
      [`${medicationId}:${scheduledAt}`, medicationId, scheduledAt, Date.now(), status],
    );
    if (status === 'taken') {
      await tx.execute(
        'UPDATE medications SET stock = MAX(stock - ?, 0) WHERE id = ?',
        [1, medicationId],
      );
    }
  });
}

export async function addStock(id: string, quantity: number): Promise<void> {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('addStock requires a non-empty medication id');
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('addStock quantity must be a positive finite number');
  }
  const db = await getDb();
  await db.execute(
    'UPDATE medications SET stock = stock + ? WHERE id = ? AND archived = 0',
    [quantity, id],
  );
}

export async function setTheme(theme: 'system' | 'light' | 'dark'): Promise<void> {
  if (theme !== 'system' && theme !== 'light' && theme !== 'dark') {
    throw new Error('theme must be system, light or dark');
  }
  const db = await getDb();
  await db.execute(
    `INSERT INTO app_settings (key, value) VALUES ('theme', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [theme],
  );
}
