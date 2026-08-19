import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { env } from './env.js';

/// Default path assumes this file lives at <repo root>/server/{src,dist}/lib/
/// — three levels up from either location lands on the repo root, so dev
/// (tsx running src directly) and prod (compiled dist) both resolve
/// correctly without needing an env var. Docker has no host filesystem
/// visible by default, so CHANGE_LOG_PATH must be set there (see
/// docker-compose.yml) to point at a mounted volume instead.
const DEFAULT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../change-log.xlsx');
const LOG_PATH = env.CHANGE_LOG_PATH || DEFAULT_PATH;

const HEADERS = ['Timestamp', 'Action', 'Task Link', 'Task Name (before)', 'Task Name (after)', 'Due (before)', 'Due (after)'];
const SHEET_NAME = 'Changes';

export interface ChangeEntry {
  action: string;
  taskLink: string;
  nameBefore?: string | null;
  nameAfter?: string | null;
  dueBefore?: string | null;
  dueAfter?: string | null;
}

/// Asana due_at is UTC ISO ("2026-08-20T09:00:00.000Z"); format it plainly
/// for a human reading the log rather than dumping raw ISO + milliseconds.
function formatDue(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 16) + ' UTC';
}

/// A field pair is only shown if it actually changed — an unrelated field
/// (e.g. name, on a due-date-only edit) is left blank in both columns per
/// the "leave empty if it didn't change" rule, rather than repeating the
/// same value twice.
function beforeAfterPair(before: string | null | undefined, after: string | null | undefined): [string, string] {
  const b = before ?? '';
  const a = after ?? '';
  return b === a ? ['', ''] : [b, a];
}

// Serializes reads/writes of the workbook file: xlsx has no true append —
// every write is read-modify-write the whole file, so concurrent commits
// (two task edits in flight at once) could otherwise race and clobber each
// other.
let writeQueue: Promise<void> = Promise.resolve();

export function recordChange(entry: ChangeEntry): void {
  writeQueue = writeQueue.then(() => appendRow(entry)).catch((err) => {
    // The audit log is a side effect, not core functionality — e.g. the
    // file being open in Excel would make it briefly unwritable. Never let
    // a logging failure break the real Asana action that already succeeded.
    console.error('changeLog: failed to record change', err);
  });
}

async function appendRow(entry: ChangeEntry): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet;
  try {
    await workbook.xlsx.readFile(LOG_PATH);
    sheet = workbook.getWorksheet(SHEET_NAME) ?? workbook.addWorksheet(SHEET_NAME);
    if (sheet.rowCount === 0) sheet.addRow(HEADERS);
  } catch {
    sheet = workbook.addWorksheet(SHEET_NAME);
    sheet.addRow(HEADERS);
    sheet.getRow(1).font = { bold: true };
    sheet.columns = [{ width: 20 }, { width: 18 }, { width: 40 }, { width: 30 }, { width: 30 }, { width: 22 }, { width: 22 }];
  }

  const [nameBefore, nameAfter] = beforeAfterPair(entry.nameBefore, entry.nameAfter);
  const [dueBefore, dueAfter] = beforeAfterPair(formatDue(entry.dueBefore), formatDue(entry.dueAfter));

  const row = sheet.addRow([new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC', entry.action, entry.taskLink, nameBefore, nameAfter, dueBefore, dueAfter]);
  const linkCell = row.getCell(3);
  linkCell.value = { text: entry.taskLink, hyperlink: entry.taskLink };
  linkCell.font = { color: { argb: 'FF0563C1' }, underline: true };

  await workbook.xlsx.writeFile(LOG_PATH);
}
