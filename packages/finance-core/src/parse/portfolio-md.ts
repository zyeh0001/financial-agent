import { CurrencyCode, type CurrencyCode as CurrencyCodeType } from "../schemas/common.js";
import { Position } from "../schemas/portfolio.js";

/**
 * Parser for the real `portfolio.md` holdings table (Layer A, Phase-1 canonical).
 *
 * Table contract (documented in the skill and portfolio.md itself):
 *   | Ticker | Shares | Avg Cost | Type | Notes |
 * under the `## Holdings` heading. Type ∈ ETF | Stock | Crypto.
 * Avg Cost may be `—` / `-` / `TBD` → cost basis unknown (null), never guessed.
 * All listed prices/costs are USD (per the file's own convention).
 */

export interface ParsedPortfolio {
  positions: Position[];
  warnings: string[];
}

const TYPE_MAP: Record<string, { assetType: "stock" | "etf" | "crypto"; bucket: "individual" | "etf" | "crypto" }> = {
  stock: { assetType: "stock", bucket: "individual" },
  etf: { assetType: "etf", bucket: "etf" },
  crypto: { assetType: "crypto", bucket: "crypto" },
};

export function parsePortfolioMd(markdown: string, costCurrency: CurrencyCodeType = "USD"): ParsedPortfolio {
  const warnings: string[] = [];
  const lines = markdown.split("\n");

  // Isolate the ## Holdings section.
  const start = lines.findIndex((l) => /^##\s+Holdings/.test(l));
  if (start === -1) throw new Error("portfolio.md: no `## Holdings` section found");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }

  const positions: Position[] = [];
  for (const line of lines.slice(start, end)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    // ["", ticker, shares, avgCost, type, notes, ""]
    const [, ticker, sharesRaw, costRaw, typeRaw, notes] = cells;
    if (ticker && (/^-+$/.test(ticker.replace(/\s/g, "")) || /^Ticker$/i.test(ticker))) continue;
    if (cells.length < 6 || !ticker) {
      throw new Error(`portfolio.md: malformed holdings row "${line.trim()}"`);
    }

    const typeKey = (typeRaw ?? "").toLowerCase();
    const mapped = TYPE_MAP[typeKey];
    if (!mapped) {
      throw new Error(`portfolio.md: unrecognized Type "${typeRaw}" for "${ticker}"`);
    }

    const quantity = Number(sharesRaw);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error(`portfolio.md: bad Shares "${sharesRaw}" for "${ticker}"`);
    }

    let averageCost: number | null;
    const costClean = (costRaw ?? "").replace(/[$,]/g, "");
    if (costClean === "" || /^(—|-|–|TBD|n\/a)$/i.test(costClean)) {
      averageCost = null;
      warnings.push(`${ticker}: cost basis unknown — unrealized P&L unavailable`);
    } else {
      averageCost = Number(costClean);
      if (!Number.isFinite(averageCost) || averageCost < 0) {
        throw new Error(`portfolio.md: bad Avg Cost "${costRaw}" for "${ticker}"`);
      }
    }

    positions.push(
      Position.parse({
        symbol: ticker,
        assetType: mapped.assetType,
        bucket: mapped.bucket,
        quantity,
        averageCost,
        costCurrency,
        ...(notes ? { notes } : {}),
      })
    );
  }

  if (positions.length === 0) throw new Error("portfolio.md: holdings table parsed to zero positions");
  const seen = new Set<string>();
  for (const p of positions) {
    if (seen.has(p.symbol)) throw new Error(`portfolio.md: duplicate ticker ${p.symbol}`);
    seen.add(p.symbol);
  }
  return { positions, warnings };
}

/**
 * Parser for the `## cash-snapshot` block in finances.md:
 *   emergency_fund: 10500
 *   dry_powder: 0
 *   brokerage_cash: 3637
 *   exchange_cash: 588
 *   currency: AUD
 */
export interface CashSnapshot {
  emergencyFund: number;
  dryPowder: number;
  brokerageCash: number;
  exchangeCash: number;
  currency: CurrencyCodeType;
  updated: string | null;
}

export function parseCashSnapshot(markdown: string): CashSnapshot {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+cash-snapshot/.test(l));
  if (start === -1) throw new Error("finances.md: no `## cash-snapshot` section found");
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end).join("\n");
  const num = (key: string): number => {
    const m = section.match(new RegExp(`^${key}:\\s*([\\d.]+)\\s*$`, "m"));
    if (!m) throw new Error(`finances.md cash-snapshot: missing ${key}`);
    return Number(m[1]);
  };
  const currencyMatch = section.match(/^currency:\s*([A-Z]{3})\s*$/m);
  if (!currencyMatch) throw new Error("finances.md cash-snapshot: missing currency");
  const currency = CurrencyCode.safeParse(currencyMatch[1]);
  if (!currency.success) {
    throw new Error(`finances.md cash-snapshot: unsupported currency "${currencyMatch[1]}"`);
  }
  const updatedMatch = section.match(/^updated:\s*(\S+)\s*$/m);

  return {
    emergencyFund: num("emergency_fund"),
    dryPowder: num("dry_powder"),
    brokerageCash: num("brokerage_cash"),
    exchangeCash: num("exchange_cash"),
    currency: currency.data,
    updated: updatedMatch?.[1] ?? null,
  };
}
