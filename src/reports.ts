import { Platform } from 'react-native';
import { generatePDF } from 'react-native-html-to-pdf';
import Share from 'react-native-share';
import { loadState } from './storage';

function toShareUrl(filePath: string): string {
  if (Platform.OS === 'android') {
    return filePath.startsWith('file://') ? filePath : `file://${filePath}`;
  }
  return filePath.replace(/^file:\/\//, '');
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scheduleLabel(med: { schedule: { kind: string; times: string[]; intervalHours: number; weekdays: number[]; activeDays: number; restDays: number } }): string {
  const s = med.schedule;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (s.kind === 'daily') {
    return `Daily at ${s.times.join(', ')}`;
  }
  if (s.kind === 'interval') {
    return `Every ${s.intervalHours} hours`;
  }
  if (s.kind === 'weekdays') {
    return `${s.weekdays.map((w) => names[w]).join(', ')} at ${s.times.join(', ')}`;
  }
  return `Cycle: ${s.activeDays} active day(s), ${s.restDays} rest day(s) at ${s.times.join(', ')}`;
}

export async function exportReport(): Promise<void> {
  const state = await loadState();
  const generatedAt = Date.now();
  const rows = state.medications
    .map((med) => {
      const doses = state.doses.filter((d) => d.medicationId === med.id);
      const taken = doses.filter((d) => d.status === 'taken').length;
      const skipped = doses.filter((d) => d.status === 'skipped').length;
      const status = med.active
        ? med.endAt !== undefined && med.endAt < generatedAt
          ? 'Completed'
          : 'Active'
        : 'Inactive';
      return `<tr>
  <td>${esc(med.name)}</td>
  <td>${esc(med.strength)}</td>
  <td>${esc(`${med.dose} ${med.unit}`)}</td>
  <td>${esc(scheduleLabel(med))}</td>
  <td>${esc(String(med.stock))}</td>
  <td>${esc(status)}</td>
  <td>${esc(fmtDate(med.startAt))}</td>
  <td>${med.endAt === undefined ? '-' : esc(fmtDate(med.endAt))}</td>
  <td>${esc(String(taken))}</td>
  <td>${esc(String(skipped))}</td>
  <td>${esc(med.notes)}</td>
</tr>`;
    })
    .join('');
  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  body { font-family: -apple-system, Roboto, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-top: 24px; }
  p.meta { font-size: 11px; color: #555; }
  table { border-collapse: collapse; width: 100%; font-size: 10px; }
  th, td { border: 1px solid #999; padding: 4px; text-align: left; vertical-align: top; }
  th { background: #eee; }
  .disclaimer { margin-top: 24px; font-size: 10px; color: #555; }
</style>
</head>
<body>
<h1>MediRecord Medication Report</h1>
<p class="meta">Generated ${esc(fmtDateTime(generatedAt))}</p>
<h2>Medications (${state.medications.length})</h2>
<table>
<thead>
<tr><th>Name</th><th>Strength</th><th>Dose</th><th>Schedule</th><th>Stock</th><th>Status</th><th>Start</th><th>End</th><th>Taken</th><th>Skipped</th><th>Notes</th></tr>
</thead>
<tbody>
${rows || '<tr><td colspan="11">No medications recorded</td></tr>'}
</tbody>
</table>
<h2>Dose History (${state.doses.length})</h2>
<table>
<thead>
<tr><th>Medication</th><th>Scheduled</th><th>Recorded</th><th>Status</th></tr>
</thead>
<tbody>
${state.doses
  .map((d) => {
    const med = state.medications.find((m) => m.id === d.medicationId);
    return `<tr><td>${esc(med ? med.name : d.medicationId)}</td><td>${esc(
      fmtDateTime(d.scheduledAt),
    )}</td><td>${esc(fmtDateTime(d.recordedAt))}</td><td>${esc(d.status)}</td></tr>`;
  })
  .join('')}
</tbody>
</table>
<p class="disclaimer">This report is a personal record of recorded doses and stock levels only. It is not medical advice. Consult a qualified healthcare professional for any medical questions.</p>
</body>
</html>`;
  const result = await generatePDF({
    html,
    fileName: `MediRecord-${new Date(generatedAt).toISOString().slice(0, 10)}`,
    base64: false,
    shouldPrintBackgrounds: true,
  });
  await Share.open({
    url: toShareUrl(result.filePath),
    type: 'application/pdf',
    title: 'MediRecord Medication Report',
    failOnCancel: false,
  });
}
