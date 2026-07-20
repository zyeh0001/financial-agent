import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { atomicWriteFile } from "@financial-agent/storage";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

const output = argument("--output");
if (!output) throw new Error("usage: npm run monitor:launchd -- --output <plist-path>");
const repoPath = resolve(process.cwd());
const investmentDirectory = resolve(
  process.env["INVESTMENT_DIR"] ?? join(homedir(), "Documents/notes/Charles/Investment")
);
const template = await readFile(join(repoPath, "launchd/com.financial-agent.monitor.plist.template"), "utf8");
const rendered = template
  .replaceAll("__NODE_PATH__", xml(process.execPath))
  .replaceAll("__REPO_PATH__", xml(repoPath))
  .replaceAll("__INVESTMENT_DIR__", xml(investmentDirectory))
  .replaceAll("__LOG_DIR__", xml(join(investmentDirectory, "data/logs")));
await mkdir(dirname(resolve(output)), { recursive: true });
await mkdir(join(investmentDirectory, "data/logs"), { recursive: true });
await atomicWriteFile(resolve(output), rendered);
console.log(`Rendered launchd agent: ${resolve(output)}`);
