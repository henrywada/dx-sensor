export function findDuplicate<T>(
  rows: T[],
  incomingKeys: { kind: string; value: string }[],
  rowKeys: (row: T) => { kind: string; value: string }[],
  opts?: {
    exclude?: (row: T) => boolean;
    include?: (row: T) => boolean;
    updatedAt: (row: T) => string;
  }
): T | null {
  const updatedAt = opts?.updatedAt;

  for (const incoming of incomingKeys) {
    const matches: T[] = [];

    for (const row of rows) {
      if (opts?.exclude?.(row)) continue;
      if (opts?.include && !opts.include(row)) continue;

      const keys = rowKeys(row);
      const hasMatch = keys.some(
        (k) => k.kind === incoming.kind && k.value === incoming.value
      );
      if (hasMatch) {
        matches.push(row);
      }
    }

    if (matches.length > 0) {
      if (!updatedAt) return matches[0];
      return matches.reduce((best, row) =>
        updatedAt(row) > updatedAt(best) ? row : best
      );
    }
  }

  return null;
}
