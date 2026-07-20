import { runDcfValuation } from "@financial-agent/finance-core";
import { runCalculationCli } from "./lib/calculation-cli.js";

await runCalculationCli({
  task: "valuation-calculation",
  filenamePrefix: "valuation",
  calculate: runDcfValuation,
});
