import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { env } from './env.js';

/// Same reasoning as changeLog.ts's DEFAULT_PATH/LOG_PATH — repo-root
/// fallback for local dev, MATCH_LOG_PATH overrides to a mounted volume
/// path in Docker (see docker-compose.yml).
const DEFAULT_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../match-log.xlsx');
const LOG_PATH = env.MATCH_LOG_PATH || DEFAULT_PATH;

const HEADERS = ['Timestamp', 'Calendar Event', 'Linked Task', 'Similarity Score', 'Suggested Rank', 'Candidates That Day'];
const SHEET_NAME = 'Matches';

/// One row per "link an existing task to a calendar event" — every one,
/// not just the ones the matcher actually suggested, so a later look at
/// this log can tell the difference between "the matcher's top pick was
/// right" and "the matcher didn't even have this task in its candidate
/// list" (matchRank null means the second case). Meant purely as raw
/// material for improving the matcher's scoring later — nothing reads this
/// log back at runtime today.
export interface MatchEntry {
  eventTitle: string;
  taskName: string;
  /// The matcher's own nameSimilarity score (0..1) for this specific
  /// event/task pair, computed client-side regardless of how the task was
  /// actually picked (from the suggested list, or a manual search that
  /// happened to land on the same task) — see store.svelte.ts's
  /// commitEventLink.
  matchScore: number;
  /// This task's position (0-based) in the suggested list at link time, or
  /// null if it wasn't suggested at all — i.e. the user had to search for
  /// it manually despite the matcher having same-day candidates to rank.
  matchRank: number | null;
  /// How many same-day tasks the matcher had to choose from — context for
  /// matchRank (a rank of 2 out of 2 candidates reads very differently
  /// than 2 out of 15).
  candidateCount: number;
}

// Same serialization reasoning as changeLog.ts: xlsx has no true append, so
// concurrent writes need to be queued rather than racing a read-modify-write.
let writeQueue: Promise<void> = Promise.resolve();

export function recordMatch(entry: MatchEntry): void {
  writeQueue = writeQueue.then(() => appendRow(entry)).catch((err) => {
    // Best-effort, same as changeLog.ts — never let logging a match break
    // the link action that already succeeded.
    console.error('matchLog: failed to record match', err);
  });
}

async function appendRow(entry: MatchEntry): Promise<void> {
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
    sheet.columns = [{ width: 20 }, { width: 42 }, { width: 42 }, { width: 16 }, { width: 16 }, { width: 18 }];
  }

  sheet.addRow([
    new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    entry.eventTitle,
    entry.taskName,
    Number(entry.matchScore.toFixed(3)),
    entry.matchRank === null ? '' : entry.matchRank + 1,
    entry.candidateCount,
  ]);

  await workbook.xlsx.writeFile(LOG_PATH);
}
