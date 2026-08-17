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
 * issued) — all four share the REPORT_ISSUE_PROXY_ prefix:
 *   REPORT_ISSUE_PROXY_URL              — the deployed Worker's base URL
 *   REPORT_ISSUE_PROXY_TOKEN            — bearer token scoped to this proxy
 *                                          only; NOT a Freedcamp/Slack
 *                                          credential, safe to rotate
 *                                          independently if it leaks
 *   REPORT_ISSUE_PROXY_PROJECT_ID       — numeric Freedcamp project_id to
 *                                          file into; not a secret, safe to
 *                                          commit in the calling project's
 *                                          own env config
 *   REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID — Slack channel ID (e.g. C0123456789,
 *                                          not a channel name) to post the
 *                                          announcement to; also not a
 *                                          secret, safe to commit
 * Missing vars are a hard error (not a silent no-op) — this posts to real,
 * team-visible systems and a silently-skipped post is worse than a crash.
 * This script does NOT load any .env-style file itself and has no opinion on
 * dotenv filenames or precedence — it only reads process.env. Loading the
 * right env vars into the process before this script runs is the calling
 * project's responsibility (its own dotenv tooling, `just` recipe, shell
 * profile, whatever it already uses), so the same skill works unmodified
 * across projects with different env-file conventions.
 */
import { readFileSync } from "node:fs";
import readline from "node:readline";

const ALLOWED_TYPES = ["fix", "feature", "refactor"];
const ALLOWED_PRIORITIES = ["low", "medium", "high"];
const TITLE_PREFIX_BY_FLAG = { fix: "[Fix]", feature: "[Feature]", refactor: "[Refactor]" };

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
  const {
    REPORT_ISSUE_PROXY_URL,
    REPORT_ISSUE_PROXY_TOKEN,
    REPORT_ISSUE_PROXY_PROJECT_ID,
    REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID,
  } = requireEnv([
    "REPORT_ISSUE_PROXY_URL",
    "REPORT_ISSUE_PROXY_TOKEN",
    "REPORT_ISSUE_PROXY_PROJECT_ID",
    "REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID",
  ]);

  const res = await fetch(`${REPORT_ISSUE_PROXY_URL.replace(/\/$/, "")}/report-issue`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${REPORT_ISSUE_PROXY_TOKEN}`,
    },
    body: JSON.stringify({
      title,
      description,
      project_id: REPORT_ISSUE_PROXY_PROJECT_ID,
      slack_channel_id: REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID,
      type,
      priority,
    }),
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
  console.log(`Project:  ${process.env.REPORT_ISSUE_PROXY_PROJECT_ID ?? "(REPORT_ISSUE_PROXY_PROJECT_ID not set)"}`);
  console.log(
    `Channel:  ${process.env.REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID ?? "(REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID not set)"}`,
  );
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
