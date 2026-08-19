export function fmtHours(h: number): string {
  const r = Math.round(h * 10) / 10;
  return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + 'h';
}
