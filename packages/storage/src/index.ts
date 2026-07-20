export * from "./files.js";
export * from "./journal.js";
export * from "./dashboard.js";
export * from "./monitoring.js";
export * from "./jsonl.js";

/**
 * Storage integrity primitives (ARCHITECTURE §5). Layer B lives under an
 * Obsidian/git-synced folder, so writes must be atomic and reads must survive
 * a crash mid-append and sync-conflict artifacts.
 */
