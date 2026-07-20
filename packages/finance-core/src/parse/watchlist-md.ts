export interface WatchlistItem {
  symbol: string;
  name: string;
  sector: string;
  dateAdded: string;
  reason: string;
  referencePrice: number | null;
  reasonableBuy: string;
  source: string;
}

export interface WatchlistGroup {
  name: string;
  items: WatchlistItem[];
}

function parseNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function cleanGroupName(raw: string): string {
  const englishParenthetical = raw.match(/\(([^)]+)\)/)?.[1];
  if (englishParenthetical && /[A-Za-z]/.test(englishParenthetical)) return englishParenthetical.trim();
  return raw.replace(/（[^）]*）\s*$/, "").trim();
}

/** Read-only parser for the canonical grouped watchlist Markdown tables. */
export function parseWatchlistMd(markdown: string): WatchlistGroup[] {
  const groups: WatchlistGroup[] = [];
  let current: WatchlistGroup | null = null;
  for (const line of markdown.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      current = { name: cleanGroupName(heading[1]), items: [] };
      groups.push(current);
      continue;
    }
    if (current === null || !/^\|\s*[A-Z][A-Z0-9.\-]{0,9}\s*\|/.test(line)) continue;
    const cells = line.split("|").map((cell) => cell.trim());
    const symbol = (cells[1] ?? "").toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) continue;
    current.items.push({
      symbol,
      name: cells[2] ?? "",
      sector: cells[3] ?? "",
      dateAdded: cells[4] ?? "",
      reason: cells[5] ?? "",
      referencePrice: parseNumber(cells[6] ?? ""),
      reasonableBuy: cells[8] ?? "",
      source: cells[9] ?? "",
    });
  }
  return groups.filter((group) => group.items.length > 0);
}
