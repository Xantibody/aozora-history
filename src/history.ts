export interface HistoryEntry {
  url: string;
  title: string;
  visitedAt: number;
}

export function sortByVisitedAt(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.toSorted((a, b) => b.visitedAt - a.visitedAt);
}
