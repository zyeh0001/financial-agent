import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { atomicWriteFile } from "@financial-agent/storage";

function value(name: string) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
function xml(input: string) { return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
const output = value("--output");
const cadence = value("--cadence") ?? "daily";
if (!output || !["daily", "weekly"].includes(cadence)) throw new Error("usage: npm run digest:launchd -- --cadence daily|weekly --output <plist-path>");
const repo = resolve(process.cwd());
const investment = resolve(process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment"));
const template = await readFile(join(repo, "launchd/com.financial-agent.digest.plist.template"), "utf8");
const rendered = template.replaceAll("__NODE_PATH__", xml(process.execPath)).replaceAll("__REPO_PATH__", xml(repo))
  .replaceAll("__INVESTMENT_DIR__", xml(investment)).replaceAll("__LOG_DIR__", xml(join(investment, "data/logs")))
  .replaceAll("__CADENCE__", cadence).replaceAll("__WEEKDAY_ENTRY__", cadence === "daily" ? "" : "<key>Weekday</key><integer>1</integer>");
await mkdir(dirname(resolve(output)), { recursive: true });
await mkdir(join(investment, "data/logs"), { recursive: true });
await atomicWriteFile(resolve(output), rendered);
console.log(`Rendered ${cadence} digest agent: ${resolve(output)}`);
