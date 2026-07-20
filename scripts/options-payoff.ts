import { runOptionPayoff } from "@financial-agent/finance-core";
import { runCalculationCli } from "./lib/calculation-cli.js";

await runCalculationCli({
  task: "options-payoff-calculation",
  filenamePrefix: "options-payoff",
  calculate: runOptionPayoff,
});
