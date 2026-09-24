import {
  MS_PER_DAY,
  MS_PER_HOUR,
  occurrences,
  validateMedication,
  type Medication,
} from '../src/domain';

function med(overrides: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Test Med',
    strength: '10mg',
    dose: 1,
    unit: 'tablet',
    stock: 30,
    lowStock: 5,
    notes: '',
    startAt: 0,
    active: true,
    schedule: {
      kind: 'daily',
      times: ['09:00'],
      intervalHours: 0,
      weekdays: [],
      activeDays: 0,
      restDays: 0,
    },
    ...overrides,
  };
}

const DAY_0 = new Date(2026, 8, 10).getTime();
const NOON = 12 * MS_PER_HOUR;

describe('validateMedication', () => {
  it('accepts a well-formed medication', () => {
    expect(() => validateMedication(med())).not.toThrow();
  });

  it('rejects empty name and bad dose', () => {
    expect(() => validateMedication(med({ name: '  ' }))).toThrow();
    expect(() => validateMedication(med({ dose: 0 }))).toThrow();
    expect(() => validateMedication(med({ dose: -1 }))).toThrow();
  });

  it('rejects negative stock', () => {
    expect(() => validateMedication(med({ stock: -1 }))).toThrow();
  });

  it('rejects endAt before startAt', () => {
    expect(() => validateMedication(med({ endAt: -1 }))).toThrow();
  });

  it('rejects malformed HH:mm times', () => {
    expect(() =>
      validateMedication(med({ schedule: { ...med().schedule, times: ['9:00'] } })),
    ).toThrow();
    expect(() =>
      validateMedication(med({ schedule: { ...med().schedule, times: ['25:00'] } })),
    ).toThrow();
  });

  it('rejects weekdays schedule with empty weekdays', () => {
    expect(() =>
      validateMedication(med({ schedule: { ...med().schedule, kind: 'weekdays', weekdays: [] } })),
    ).toThrow();
  });

  it('rejects weekdays outside 0-6', () => {
    expect(() =>
      validateMedication(med({ schedule: { ...med().schedule, kind: 'weekdays', weekdays: [7] } })),
    ).toThrow();
  });

  it('rejects interval schedule with intervalHours <= 0', () => {
    expect(() =>
      validateMedication(
        med({ schedule: { ...med().schedule, kind: 'interval', intervalHours: 0 } }),
      ),
    ).toThrow();
  });

  it('rejects cycle schedule with activeDays < 1', () => {
    expect(() =>
      validateMedication(med({ schedule: { ...med().schedule, kind: 'cycle', activeDays: 0 } })),
    ).toThrow();
  });
});

describe('occurrences daily', () => {
  it('returns one occurrence per day at the local wallclock time', () => {
    const m = med({ startAt: DAY_0, schedule: { ...med().schedule, times: ['09:00'] } });
    const from = new Date(2026, 8, 10).getTime();
    const to = new Date(2026, 8, 13, 23, 59).getTime();
    const times = occurrences(m, from, to);
    expect(times).toHaveLength(4);
    for (const ts of times) {
      const d = new Date(ts);
      expect(d.getHours()).toBe(9);
      expect(d.getMinutes()).toBe(0);
    }
  });

  it('excludes occurrences before startAt', () => {
    const m = med({ startAt: DAY_0 + 2 * MS_PER_DAY });
    const from = new Date(2026, 8, 10).getTime();
    const to = new Date(2026, 8, 13, 23, 59).getTime();
    const times = occurrences(m, from, to);
    expect(times.every((ts) => ts >= m.startAt)).toBe(true);
    expect(times.length).toBeGreaterThan(0);
  });

  it('returns empty for inactive medications', () => {
    const m = med({ active: false });
    expect(occurrences(m, DAY_0, DAY_0 + 7 * MS_PER_DAY)).toEqual([]);
  });

  it('honors endAt', () => {
    const endAt = DAY_0 + 2 * MS_PER_DAY + NOON;
    const m = med({ startAt: DAY_0, endAt });
    const from = new Date(2026, 8, 10).getTime();
    const to = new Date(2026, 8, 20).getTime();
    const times = occurrences(m, from, to);
    expect(times.every((ts) => ts <= endAt)).toBe(true);
  });
});

describe('occurrences interval', () => {
  it('uses elapsed time from anchor, not local wallclock', () => {
    const startAt = new Date(2026, 8, 10, 8, 30).getTime();
    const m = med({ startAt, schedule: { ...med().schedule, kind: 'interval', intervalHours: 8 } });
    const from = new Date(2026, 8, 11).getTime();
    const to = new Date(2026, 8, 11, 23, 59).getTime();
    const times = occurrences(m, from, to);
    const diffs = times.map((ts) => (ts - (startAt + 16 * MS_PER_HOUR)) / MS_PER_HOUR);
    expect(times).toHaveLength(3);
    expect(diffs[0]).toBe(0.5);
    expect(diffs[1]).toBe(8.5);
    expect(diffs[2]).toBe(16.5);
  });

  it('keeps constant spacing across DST-like drifts', () => {
    const startAt = new Date(2026, 0, 1, 0, 0).getTime();
    const m = med({ startAt, schedule: { ...med().schedule, kind: 'interval', intervalHours: 6 } });
    const from = startAt + 24 * MS_PER_HOUR;
    const to = from + 24 * MS_PER_HOUR;
    const times = occurrences(m, from, to);
    for (let i = 1; i < times.length; i++) {
      expect(times[i]! - times[i - 1]!).toBe(6 * MS_PER_HOUR);
    }
  });
});

describe('occurrences weekdays', () => {
  it('only emits on configured weekdays', () => {
    const m = med({
      startAt: DAY_0,
      schedule: { ...med().schedule, kind: 'weekdays', weekdays: [1, 3], times: ['08:00', '20:00'] },
    });
    const from = new Date(2026, 8, 10).getTime();
    const to = new Date(2026, 8, 20).getTime();
    const times = occurrences(m, from, to);
    for (const ts of times) {
      expect([1, 3]).toContain(new Date(ts).getDay());
    }
    expect(times.length).toBeGreaterThan(0);
  });
});

describe('occurrences cycle', () => {
  it('skips rest days', () => {
    const m = med({
      startAt: DAY_0,
      schedule: { ...med().schedule, kind: 'cycle', activeDays: 2, restDays: 2, times: ['09:00'] },
    });
    const from = new Date(2026, 8, 10).getTime();
    const to = new Date(2026, 8, 20).getTime();
    const times = occurrences(m, from, to);
    const days = [...new Set(times.map((ts) => new Date(ts).getDate()))].sort((a, b) => a - b);
    expect(days).toEqual([10, 11, 14, 15, 18, 19]);
  });
});

describe('occurrences bounds', () => {
  it('is bounded and sorted for a wide range', () => {
    const m = med({
      startAt: 0,
      schedule: { ...med().schedule, times: ['00:00', '06:00', '12:00', '18:00'] },
    });
    const from = 0;
    const to = Date.now() + 365 * MS_PER_DAY;
    const times = occurrences(m, from, to);
    expect(times.length).toBeLessThanOrEqual(500);
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('throws on inverted range', () => {
    const m = med();
    expect(() => occurrences(m, DAY_0 + 1000, DAY_0)).toThrow();
  });
});
