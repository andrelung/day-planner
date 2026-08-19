/// Ports the duration-in-title convention from asana-to-mongo-replicator's
/// postprocessor.ts (getSingleTaskDurationFromName / getNameClean), so Asana
/// task titles read the same way across both tools.
///
/// Convention (always the LAST bracket group in the title):
///   "Draft outline [4]"     -> 4h
///   "Draft outline [1,5]"   -> 1.5h  (comma as decimal separator, German locale)
///   "Draft outline [1/6]"   -> 6h    (only the part after the last "/" counts)
///   "Draft outline [∑5,5]"  -> 5.5h  (∑ marks a subtask-rollup total; parses the same)
///   "Draft outline [SUM]"   -> null  (non-numeric bracket content)
///   "Draft outline"         -> null  (no bracket at all)

function fixFloatingPointPrecision(value: number, precision = 2): number {
  const factor = Math.pow(10, precision);
  return Math.round(value * factor) / factor;
}

export function parseDurationFromTitle(taskName: string): number | null {
  let left = taskName.lastIndexOf('[');
  if (taskName.lastIndexOf('[∑') >= left) {
    left = taskName.lastIndexOf('[∑') + 1;
  }
  const right = taskName.lastIndexOf(']');

  let parsedNumber: number | null = null;
  if (left >= 0 && right > 0) {
    let content = taskName.substring(left + 1, right);
    const statusDividerPosition = content.lastIndexOf('/');
    if (statusDividerPosition >= 0) {
      content = content.substring(statusDividerPosition + 1);
    }
    content = content.replace(',', '.');
    parsedNumber = parseFloat(content);
  }

  if (parsedNumber === null || isNaN(parsedNumber)) {
    return null;
  }
  return fixFloatingPointPrecision(parsedNumber, 2);
}

/// The title with its trailing bracket annotation (if any) removed.
export function cleanTitle(taskName: string): string {
  const leftAnchor = taskName.lastIndexOf('[');
  if (leftAnchor >= 0) {
    return taskName.substring(0, leftAnchor).trimEnd();
  }
  return taskName.trimEnd();
}

function formatHours(hours: number): string {
  // Plain dot-decimal, no trailing zeros (e.g. 4, 1.5, 0.5) — the reader
  // above accepts this directly since its `,` -> `.` replace is a no-op
  // when there's no comma.
  return Number(hours.toFixed(2)).toString();
}

/// Builds a new title with the duration bracket set to `hours`, replacing
/// any existing trailing bracket. Never writes the "∑"/"/" summary forms —
/// those are read-only conventions from other tools' rollup calculations.
export function titleWithDuration(currentTitle: string, hours: number): string {
  return `${cleanTitle(currentTitle)} [${formatHours(hours)}]`;
}
