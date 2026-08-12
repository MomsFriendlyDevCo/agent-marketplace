#!/usr/bin/env node
/**
 * File an issue in MFDC's Freedcamp Issue Tracker and announce it in Slack, via
 * the report-issue proxy Worker (source: infra/report-issue-proxy in this
 * marketplace repo, deployed separately from wherever this plugin installs).
 *
 * This is the posting half of the report-issue skill (../SKILL.md). It does not
 * write docs, export chat logs, or touch git — the calling agent does that first
 * and passes in finished paths/URLs. This script only builds the request and
 * sends it to the proxy, which holds the real Freedcamp/Slack credentials.
 *
 * Deliberately dependency-free (Node built-ins only, no npm install) so this
 * skill — and the plugin it lives in — stays portable with no package.json or
 * node_modules to install.
 *
 * Usage:
 *   node report-issue.mjs \
 *     --title "Pet-friendly filter applies to non-park POIs" \
 *     --type fix \
 *     --report docs/20260812-001_ISSUE-REPORT-pet-friendly-filter.md \
 *     --proposal docs/20260812-001_ISSUE-PROPOSAL-pet-friendly-filter.md \
 *     --commit-url https://github.com/org/repo/commit/<sha> \
 *     [--priority low|medium|high] [--dry-run] [--yes]
 *
 * Required env (see infra/report-issue-proxy/README.md for how these are
 * issued):
 *   REPORT_ISSUE_PROXY_URL    — the deployed Worker's base URL
 *   REPORT_ISSUE_PROXY_TOKEN  — bearer token scoped to this proxy only; NOT a
 *                                Freedcamp/Slack credential, safe to rotate
 *                                independently if it ever leaks
 * Missing vars are a hard error (not a silent no-op) — this posts to real,
 * team-visible systems and a silently-skipped post is worse than a crash.
 * A `.env` file is auto-loaded by walking up from the current directory if one
 * exists, without overriding anything already set in the real environment.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ALLOWED_TYPES = ["fix", "feature", "refactor"];
const ALLOWED_PRIORITIES = ["low", "medium", "high"];
const TITLE_PREFIX_BY_FLAG = { fix: "[Fix]", feature: "[Feature]", refactor: "[Refactor]" };

function loadDotEnvUpwards(startDir) {
  let dir = startDir;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, "utf8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function parseArgs(argv) {
  const flags = { type: "fix", priority: "medium", dryRun: false, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") { flags.dryRun = true; continue; }
    if (arg === "--yes") { flags.yes = true; continue; }
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${arg.slice(2)} needs a value`);
      flags[key] = value;
      continue;
    }
    throw new Error(`Unrecognized argument: ${arg}`);
  }
  return flags;
}

function requireEnv(names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    console.error(`ERROR: missing required env var(s): ${missing.join(", ")}`);
    console.error("Set them in .env or your shell before running this script.");
    console.error("See infra/report-issue-proxy/README.md for how to obtain them.");
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n]]));
}

async function postToProxy({ title, description, type, priority }) {
  const { REPORT_ISSUE_PROXY_URL, REPORT_ISSUE_PROXY_TOKEN } = requireEnv([
    "REPORT_ISSUE_PROXY_URL",
    "REPORT_ISSUE_PROXY_TOKEN",
  ]);

  const res = await fetch(`${REPORT_ISSUE_PROXY_URL.replace(/\/$/, "")}/report-issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${REPORT_ISSUE_PROXY_TOKEN}`,
    },
    body: JSON.stringify({ title, description, type, priority }),
  });
  const json = await res.json().catch(() => null);
  console.log(`Proxy HTTP ${res.status}:`, JSON.stringify(json, null, 2));

  if (!res.ok || !json?.ok) {
    throw new Error("report-issue proxy call failed (see response above)");
  }
  return json;
}

function confirmPrompt(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function main() {
  loadDotEnvUpwards(process.cwd());
  const opts = parseArgs(process.argv.slice(2));

  for (const [flag, name] of [
    ["title", "--title"],
    ["report", "--report"],
    ["proposal", "--proposal"],
    ["commitUrl", "--commit-url"],
  ]) {
    if (!opts[flag]) { console.error(`${name} is required`); process.exit(1); }
  }
  if (!ALLOWED_TYPES.includes(opts.type)) { console.error(`--type must be one of: ${ALLOWED_TYPES.join(", ")}`); process.exit(1); }
  if (!ALLOWED_PRIORITIES.includes(opts.priority)) { console.error(`--priority must be one of: ${ALLOWED_PRIORITIES.join(", ")}`); process.exit(1); }

  const reportBody = readFileSync(opts.report, "utf8");
  const proposalBody = readFileSync(opts.proposal, "utf8");

  const description = [
    `Commit: ${opts.commitUrl}`,
    "",
    "## Initial report",
    reportBody,
    "",
    "## Proposed changes",
    proposalBody,
  ].join("\n");

  const fullTitle = `${TITLE_PREFIX_BY_FLAG[opts.type]} ${opts.title}`;

  console.log("=== Preview ===");
  console.log(`Title:    ${fullTitle}`);
  console.log(`Type:     ${opts.type}   Priority: ${opts.priority}`);
  console.log(`Proxy:    ${process.env.REPORT_ISSUE_PROXY_URL ?? "(REPORT_ISSUE_PROXY_URL not set)"}`);
  console.log(`Commit:   ${opts.commitUrl}`);
  console.log(`Report:   ${opts.report}`);
  console.log(`Proposal: ${opts.proposal}`);
  console.log("================");

  if (opts.dryRun) {
    console.log("--dry-run set: stopping before any network call.");
    return;
  }

  if (!opts.yes) {
    const ok = await confirmPrompt(
      "This creates a LIVE Freedcamp issue and posts to Slack, visible to the whole team. Proceed?",
    );
    if (!ok) { console.log("Aborted."); return; }
  }

  const result = await postToProxy({ title: fullTitle, description, type: opts.type, priority: opts.priority });

  console.log("=== Done ===");
  console.log(`Freedcamp issue #${result.freedcampIssueId}: ${result.freedcampUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
