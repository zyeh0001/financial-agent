import type { CurrencyCode } from "../schemas/common.js";
import type { AnyTransaction } from "../schemas/transaction.js";

/**
 * Deterministic portfolio math. All report arithmetic comes from here —
 * the model never does mental math into a report (ARCHITECTURE §9).
 *
 * Cost-basis method: weighted average, buy fees capitalized into basis,
 * sell fees deducted from proceeds (broker-compatible; documented simplification —
 * lot-level basis arrives with broker import in Phase 2 if needed).
 *
 * Known Phase-1 simplification: realized P&L and dividends are converted to the
 * valuation currency at the CURRENT fx rate, not the rate at transaction time.
 * Historical-fx accuracy arrives with transaction import (Phase 2).
 */

export interface Holding {
  symbol: string;
  quantity: number;
  /** weighted average cost per unit incl. buy fees; null = cost basis unknown */
  averageCost: number | null;
  currency: CurrencyCode;
}

export interface LedgerState {
  holdings: Map<string, Holding>;
  cash: Map<CurrencyCode, number>;
  /** realized P&L per currency (sell proceeds net of fees minus basis) */
  realizedPnl: Map<CurrencyCode, number>;
  /** dividend income per currency */
  dividends: Map<CurrencyCode, number>;
}

function bump(map: Map<CurrencyCode, number>, currency: CurrencyCode, delta: number): void {
  map.set(currency, (map.get(currency) ?? 0) + delta);
}

/**
 * Build a ledger directly from a declared portfolio state (Phase 1: parsed
 * portfolio.md + cash-snapshot) — the no-transaction-history path.
 */
export function ledgerFromState(state: {
  positions: Array<{
    symbol: string;
    quantity: number;
    averageCost: number | null;
    costCurrency: CurrencyCode;
  }>;
  cash: Array<{ currency: CurrencyCode; amount: number }>;
}): LedgerState {
  const ledger: LedgerState = {
    holdings: new Map(),
    cash: new Map(),
    realizedPnl: new Map(),
    dividends: new Map(),
  };
  for (const p of state.positions) {
    if (ledger.holdings.has(p.symbol)) throw new Error(`duplicate position: ${p.symbol}`);
    ledger.holdings.set(p.symbol, {
      symbol: p.symbol,
      quantity: p.quantity,
      averageCost: p.averageCost,
      currency: p.costCurrency,
    });
  }
  for (const c of state.cash) bump(ledger.cash, c.currency, c.amount);
  return ledger;
}

export function processTransactions(transactions: AnyTransaction[]): LedgerState {
  const state: LedgerState = {
    holdings: new Map(),
    cash: new Map(),
    realizedPnl: new Map(),
    dividends: new Map(),
  };

  for (const tx of transactions) {
    switch (tx.type) {
      case "DEPOSIT":
        bump(state.cash, tx.currency, tx.amount);
        break;
      case "WITHDRAWAL":
        bump(state.cash, tx.currency, -tx.amount);
        break;
      case "FEE":
        bump(state.cash, tx.currency, -tx.amount);
        break;
      case "DIVIDEND":
        bump(state.cash, tx.currency, tx.amount);
        bump(state.dividends, tx.currency, tx.amount);
        break;
      case "FX_CONVERT":
        bump(state.cash, tx.fromCurrency, -tx.fromAmount);
        bump(state.cash, tx.toCurrency, tx.toAmount);
        break;
      case "BUY": {
        const fee = tx.fee ?? 0;
        const cost = tx.quantity * tx.price + fee;
        bump(state.cash, tx.currency, -cost);
        const existing = state.holdings.get(tx.symbol);
        if (existing) {
          if (existing.currency !== tx.currency) {
            throw new Error(`currency mismatch for ${tx.symbol}: ${existing.currency} vs ${tx.currency}`);
          }
          if (existing.averageCost === null) {
            throw new Error(`cannot BUY into ${tx.symbol}: existing cost basis unknown`);
          }
          const totalQty = existing.quantity + tx.quantity;
          existing.averageCost = (existing.quantity * existing.averageCost + cost) / totalQty;
          existing.quantity = totalQty;
        } else {
          state.holdings.set(tx.symbol, {
            symbol: tx.symbol,
            quantity: tx.quantity,
            averageCost: cost / tx.quantity,
            currency: tx.currency,
          });
        }
        break;
      }
      case "SELL": {
        const fee = tx.fee ?? 0;
        const holding = state.holdings.get(tx.symbol);
        if (!holding) throw new Error(`SELL of unheld symbol: ${tx.symbol}`);
        if (tx.quantity > holding.quantity + 1e-9) {
          throw new Error(`SELL ${tx.quantity} exceeds held ${holding.quantity} for ${tx.symbol}`);
        }
        if (holding.averageCost === null) {
          throw new Error(`cannot SELL ${tx.symbol}: cost basis unknown — record it first`);
        }
        const proceeds = tx.quantity * tx.price - fee;
        bump(state.cash, tx.currency, proceeds);
        bump(state.realizedPnl, tx.currency, proceeds - tx.quantity * holding.averageCost);
        holding.quantity -= tx.quantity;
        if (holding.quantity <= 1e-9) state.holdings.delete(tx.symbol);
        break;
      }
    }
  }
  return state;
}

// ---------------------------------------------------------------------------

export interface Quote {
  symbol: string;
  price: number;
  currency: CurrencyCode;
  asOf: string; // ISO timestamp
  source: string;
}

export interface ValuationInput {
  ledger: LedgerState;
  quotes: Record<string, Quote>;
  /** e.g. { USDAUD: 1.55 } — 1 USD = 1.55 AUD */
  fx: Record<string, number>;
  fxTimestamp: string;
  valuationCurrency: CurrencyCode;
  /** classification for bucket weights (symbol → bucket) */
  buckets: Record<string, "individual" | "etf" | "crypto">;
  now: string; // ISO timestamp
  staleAfterHours?: number;
  riskLimits?: { singleStockMax?: number };
}

export interface ValuedPosition {
  symbol: string;
  quantity: number;
  price: number;
  quoteCurrency: CurrencyCode;
  value: number; // in valuation currency
  weight: number; // of total portfolio value
  unrealizedPnl: number | null; // in valuation currency; null = cost basis unknown
  stale: boolean;
}

export interface Valuation {
  valuationCurrency: CurrencyCode;
  totalValue: number;
  positions: ValuedPosition[];
  cash: Record<string, number>; // native amounts per currency
  bucketWeights: Record<string, number>;
  currencyExposure: Record<string, number>; // fraction of total per exposure currency
  realizedPnl: number; // valuation currency (current-fx simplification)
  dividends: number; // valuation currency (current-fx simplification)
  staleQuotes: string[];
  concentrationFlags: string[]; // individual stocks over singleStockMax
}

/**
 * Quote age excluding weekend hours (UTC Sat/Sun) — a Friday-close quote read
 * on Monday morning is fresh, not 60h stale. Approximation: US market weekend
 * ≈ UTC weekend; exchange holidays are NOT modeled (acceptable false-stale on
 * holiday Mondays — errs toward caution, never toward false freshness).
 */
export function marketAgeHours(asOfMs: number, nowMs: number): number {
  let weekendMs = 0;
  const start = new Date(asOfMs);
  for (
    let t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    t < nowMs;
    t += 86_400_000
  ) {
    const day = new Date(t).getUTCDay();
    if (day === 6 || day === 0) {
      const overlap = Math.min(t + 86_400_000, nowMs) - Math.max(t, asOfMs);
      if (overlap > 0) weekendMs += overlap;
    }
  }
  return (nowMs - asOfMs - weekendMs) / 3_600_000;
}

export function convert(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  fx: Record<string, number>
): number {
  if (from === to) return amount;
  const direct = fx[`${from}${to}`];
  if (direct !== undefined) return amount * direct;
  const inverse = fx[`${to}${from}`];
  if (inverse !== undefined) return amount / inverse;
  throw new Error(`no fx rate for ${from}->${to}`);
}

export function valuePortfolio(input: ValuationInput): Valuation {
  const {
    ledger,
    quotes,
    fx,
    valuationCurrency,
    buckets,
    now,
    staleAfterHours = 30,
    riskLimits = {},
  } = input;
  const singleStockMax = riskLimits.singleStockMax ?? 0.1;
  const nowMs = Date.parse(now);

  const staleQuotes: string[] = [];
  const positions: ValuedPosition[] = [];
  let positionsTotal = 0;

  for (const holding of ledger.holdings.values()) {
    const quote = quotes[holding.symbol];
    if (!quote) throw new Error(`missing quote for ${holding.symbol}`);
    if (quote.currency !== holding.currency) {
      throw new Error(
        `currency mismatch for ${holding.symbol}: cost basis is ${holding.currency}, quote is ${quote.currency}`
      );
    }
    const stale = marketAgeHours(Date.parse(quote.asOf), nowMs) > staleAfterHours;
    if (stale) staleQuotes.push(holding.symbol);

    const nativeValue = holding.quantity * quote.price;
    const value = convert(nativeValue, quote.currency, valuationCurrency, fx);
    const unrealizedPnl =
      holding.averageCost === null
        ? null
        : convert(
            holding.quantity * (quote.price - holding.averageCost),
            quote.currency,
            valuationCurrency,
            fx
          );
    positions.push({
      symbol: holding.symbol,
      quantity: holding.quantity,
      price: quote.price,
      quoteCurrency: quote.currency,
      value,
      weight: 0, // filled after total known
      unrealizedPnl,
      stale,
    });
    positionsTotal += value;
  }

  const cash: Record<string, number> = {};
  let cashTotal = 0;
  for (const [currency, amount] of ledger.cash) {
    cash[currency] = amount;
    cashTotal += convert(amount, currency, valuationCurrency, fx);
  }

  const totalValue = positionsTotal + cashTotal;
  if (totalValue <= 0) throw new Error("portfolio total value must be positive to compute weights");

  const bucketWeights: Record<string, number> = {};
  const currencyExposure: Record<string, number> = {};
  const concentrationFlags: string[] = [];

  for (const p of positions) {
    p.weight = p.value / totalValue;
    const bucket = buckets[p.symbol];
    if (!bucket) throw new Error(`missing bucket classification for ${p.symbol}`);
    bucketWeights[bucket] = (bucketWeights[bucket] ?? 0) + p.weight;
    currencyExposure[p.quoteCurrency] = (currencyExposure[p.quoteCurrency] ?? 0) + p.weight;
    if (bucket === "individual" && p.weight > singleStockMax) concentrationFlags.push(p.symbol);
  }
  for (const [currency, amount] of ledger.cash) {
    const weight = convert(amount, currency, valuationCurrency, fx) / totalValue;
    bucketWeights["cash"] = (bucketWeights["cash"] ?? 0) + weight;
    currencyExposure[currency] = (currencyExposure[currency] ?? 0) + weight;
  }

  let realizedPnl = 0;
  for (const [currency, amount] of ledger.realizedPnl) {
    realizedPnl += convert(amount, currency, valuationCurrency, fx);
  }
  let dividends = 0;
  for (const [currency, amount] of ledger.dividends) {
    dividends += convert(amount, currency, valuationCurrency, fx);
  }

  positions.sort((a, b) => b.value - a.value);
  staleQuotes.sort();
  concentrationFlags.sort();

  return {
    valuationCurrency,
    totalValue,
    positions,
    cash,
    bucketWeights,
    currencyExposure,
    realizedPnl,
    dividends,
    staleQuotes,
    concentrationFlags,
  };
}
