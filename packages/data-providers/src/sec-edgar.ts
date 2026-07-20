import { z } from "zod";
import type { FilingRef, FilingsProvider } from "./interfaces.js";

const TickerRecord = z
  .object({
    cik_str: z.number().int().nonnegative(),
    ticker: z.string().min(1),
    title: z.string().min(1),
  })
  .passthrough();
const TickerMap = z.record(z.string(), TickerRecord);

const RecentFilings = z
  .object({
    accessionNumber: z.array(z.string()),
    filingDate: z.array(z.string()),
    form: z.array(z.string()),
    primaryDocument: z.array(z.string()),
  })
  .passthrough();
const Submissions = z
  .object({ filings: z.object({ recent: RecentFilings }).passthrough() })
  .passthrough();

export interface SecEdgarProviderOptions {
  /** SEC requires a declared product/company name plus contact email. */
  userAgent: string;
  fetchImpl?: typeof fetch;
}

/**
 * Read-only adapter for the official SEC submissions API and filing archive.
 * Callers remain responsible for scheduling at less than SEC's 10 requests/s ceiling.
 */
export class SecEdgarProvider implements FilingsProvider {
  readonly name = "sec-edgar";
  private readonly userAgent: string;
  private readonly fetchImpl: typeof fetch;
  private tickerMap: Promise<z.infer<typeof TickerMap>> | undefined;

  constructor(options: SecEdgarProviderOptions) {
    const userAgent = options.userAgent.trim();
    if (userAgent.length < 5 || !userAgent.includes("@") || /[\r\n]/.test(userAgent)) {
      throw new Error("SEC User-Agent must contain a product name and contact email");
    }
    this.userAgent = userAgent;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const response = await this.fetchImpl(url, {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
    });
    if (!response.ok) throw new Error(`SEC request failed (${response.status} ${response.statusText})`);
    return response.json();
  }

  private loadTickerMap() {
    this.tickerMap ??= this.fetchJson("https://www.sec.gov/files/company_tickers.json").then((value) => TickerMap.parse(value));
    return this.tickerMap;
  }

  async searchFilings(symbolCandidate: string, formTypes?: string[]): Promise<FilingRef[]> {
    const symbol = symbolCandidate.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,20}$/.test(symbol)) throw new Error(`invalid SEC ticker: ${symbolCandidate}`);
    const requestedForms = formTypes?.map((formType) => formType.trim().toUpperCase());
    if (requestedForms?.some((formType) => !/^[A-Z0-9][A-Z0-9 /-]{0,19}$/.test(formType))) {
      throw new Error("invalid SEC form type");
    }

    const tickerMap = await this.loadTickerMap();
    const company = Object.values(tickerMap).find(
      (candidate) => candidate.ticker.toUpperCase() === symbol
    );
    if (company === undefined) throw new Error(`SEC ticker not found: ${symbol}`);

    const paddedCik = company.cik_str.toString().padStart(10, "0");
    const submissions = Submissions.parse(
      await this.fetchJson(`https://data.sec.gov/submissions/CIK${paddedCik}.json`)
    );
    const recent = submissions.filings.recent;
    const lengths = [
      recent.accessionNumber.length,
      recent.filingDate.length,
      recent.form.length,
      recent.primaryDocument.length,
    ];
    if (!lengths.every((length) => length === lengths[0])) {
      throw new Error("SEC submissions response has misaligned filing arrays");
    }

    return recent.form.flatMap((formType, index): FilingRef[] => {
      if (requestedForms !== undefined && !requestedForms.includes(formType.toUpperCase())) return [];
      const accessionNumber = recent.accessionNumber[index]!;
      const filingDate = recent.filingDate[index]!;
      const primaryDocument = recent.primaryDocument[index]!;
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) {
        throw new Error(`invalid accession number from SEC: ${accessionNumber}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || Number.isNaN(Date.parse(filingDate))) {
        throw new Error(`invalid filing date from SEC: ${filingDate}`);
      }
      if (!/^[A-Za-z0-9._-]+$/.test(primaryDocument)) {
        throw new Error(`invalid primary document from SEC: ${primaryDocument}`);
      }
      const accessionPath = accessionNumber.replaceAll("-", "");
      return [
        {
          symbol,
          formType,
          filedAt: `${filingDate}T00:00:00Z`,
          url: `https://www.sec.gov/Archives/edgar/data/${company.cik_str}/${accessionPath}/${primaryDocument}`,
          source: this.name,
        },
      ];
    });
  }

  async getFiling(ref: FilingRef): Promise<string> {
    const url = new URL(ref.url);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.sec.gov" ||
      !/^\/Archives\/edgar\/data\/\d+\/\d+\/[A-Za-z0-9._-]+$/.test(url.pathname)
    ) {
      throw new Error("filing reference is not an allowlisted SEC archive URL");
    }
    const response = await this.fetchImpl(url.toString(), {
      headers: {
        "User-Agent": this.userAgent,
        Accept: "text/html,text/plain,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate",
      },
    });
    if (!response.ok) throw new Error(`SEC filing request failed (${response.status} ${response.statusText})`);
    const content = await response.text();
    if (content.length > 20_000_000) throw new Error("SEC filing exceeds the 20 MB safety limit");
    return content;
  }
}
