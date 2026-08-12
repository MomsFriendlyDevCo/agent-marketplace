#!/usr/bin/env node
/**
 * Exports the current Claude Code session's transcript to a Markdown chat
 * log. Skills can't invoke the interactive `/export` slash command directly
 * (it only exists as a UI command), so this reimplements the part of it this
 * skill needs: locate this session's `.jsonl` transcript under
 * `~/.claude/projects/` and render it as readable Markdown.
 *
 * This is the export half of the report-issue skill (../SKILL.md), used in
 * step 2 in place of `/export`. It does not decide the output path — the
 * calling agent passes `--out` with the repo's own naming convention.
 *
 * Deliberately dependency-free (Node built-ins only), matching
 * report-issue.mjs in this same directory.
 *
 * Usage:
 *   node export-chatlog.mjs --out docs/exports/20260813-001_my-issue-chatlog.md
 *
 * The transcript is located via the CLAUDE_CODE_SESSION_ID env var (set by
 * Claude Code for every session), not by scanning ~/.claude/projects/ for the
 * most-recently-modified file — that heuristic picks the wrong transcript
 * whenever more than one Claude Code session is open at once (a common case:
 * multiple terminals against the same or related projects).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

function findTranscriptPath(sessionId) {
  const projectsDir = path.join(os.homedir(), ".claude", "projects");
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`No transcript found for session ${sessionId} under ${projectsDir}`);
}

function textFromUserContent(content) {
  if (typeof content === "string") return content;
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function toolResultsFromUserContent(content) {
  if (typeof content === "string") return [];
  return content.filter((block) => block.type === "tool_result");
}

function formatToolResultContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === "text" ? c.text : JSON.stringify(c, null, 2))).join("\n");
  }
  return JSON.stringify(content, null, 2);
}

// Renders one assistant content block, or null for blocks that don't belong
// in a human-readable transcript (e.g. `thinking`, which is usually redacted
// to an empty string with an opaque signature anyway).
function renderAssistantBlock(block, toolNameById) {
  if (block.type === "text") return block.text;
  if (block.type === "tool_use") {
    toolNameById.set(block.id, block.name);
    return `**Tool call: ${block.name}**\n\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\``;
  }
  return null;
}

function parseTranscript(transcriptPath) {
  const lines = readFileSync(transcriptPath, "utf8").split("\n").filter(Boolean);
  const toolNameById = new Map();
  const turns = [];

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.isSidechain) continue; // subagent transcript, not the main conversation

    if (entry.type === "user") {
      const text = textFromUserContent(entry.message.content);
      if (text.trim()) turns.push({ role: "user", text });
      for (const toolResult of toolResultsFromUserContent(entry.message.content)) {
        turns.push({
          role: "tool-result",
          name: toolNameById.get(toolResult.tool_use_id) ?? "tool",
          body: formatToolResultContent(toolResult.content),
          isError: !!toolResult.is_error,
        });
      }
      continue;
    }

    if (entry.type === "assistant") {
      const parts = entry.message.content
        .map((block) => renderAssistantBlock(block, toolNameById))
        .filter(Boolean);
      if (parts.length > 0) turns.push({ role: "assistant", parts });
      continue;
    }

    // system / mode / permission-mode / last-prompt / ai-title /
    // file-history-* / attachment — session metadata, not conversation
    // content, deliberately skipped.
  }

  return turns;
}

// Best-effort heuristic secret scan — a defense-in-depth pass, not a
// guarantee. It catches recognizable formats and common
// SECRET/TOKEN/PASSWORD/KEY-style assignments, but a human still has to
// review the file (see SKILL.md step 2) before it's committed: freeform
// pasted values (a raw password with no surrounding label, an internal
// customer identifier, someone's name) won't match any of these patterns.
const REDACTION_RULES = [
  {
    name: "private-key",
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => "[REDACTED:private-key]",
  },
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => "[REDACTED:aws-access-key]" },
  { name: "github-token", regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g, replace: () => "[REDACTED:github-token]" },
  { name: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, replace: () => "[REDACTED:slack-token]" },
  {
    name: "slack-webhook",
    regex: /https:\/\/hooks\.slack\.com\/services\/\S+/g,
    replace: () => "[REDACTED:slack-webhook]",
  },
  {
    name: "jwt",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    replace: () => "[REDACTED:jwt]",
  },
  { name: "sk-api-key", regex: /\bsk-[A-Za-z0-9]{20,}\b/g, replace: () => "[REDACTED:sk-api-key]" },
  {
    name: "bearer-token",
    regex: /\bBearer\s+[A-Za-z0-9\-_.=]{20,}/g,
    replace: () => "Bearer [REDACTED:bearer-token]",
  },
  // KEY=value / KEY: value / KEY="value" where KEY looks secret-shaped —
  // the broadest rule, so it runs last and only touches what nothing more
  // specific already caught.
  {
    name: "env-assignment",
    regex:
      /\b([A-Za-z_][A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PWD|API_KEY|APIKEY|PRIVATE_KEY|CREDENTIAL)[A-Za-z0-9_]*)\s*([=:])\s*["']?([^\s"'`,;]{4,})["']?/gi,
    replace: (_match, varName, sep) => `${varName}${sep} [REDACTED:env-assignment]`,
  },
];

function redactSecrets(markdown) {
  const counts = new Map();
  let redacted = markdown;
  for (const rule of REDACTION_RULES) {
    redacted = redacted.replace(rule.regex, (...args) => {
      counts.set(rule.name, (counts.get(rule.name) ?? 0) + 1);
      return rule.replace(...args);
    });
  }
  return { markdown: redacted, counts };
}

function renderMarkdown(turns, sessionId) {
  const md = [`# Chat log export`, "", `Session: \`${sessionId}\``, `Exported: ${new Date().toISOString()}`, ""];

  let pendingClaudeParts = [];
  const flushClaude = () => {
    if (pendingClaudeParts.length === 0) return;
    md.push("### Claude", "", pendingClaudeParts.join("\n\n"), "");
    pendingClaudeParts = [];
  };

  for (const turn of turns) {
    if (turn.role === "user") {
      flushClaude();
      md.push("### User", "", turn.text, "");
    } else if (turn.role === "assistant") {
      pendingClaudeParts.push(...turn.parts);
    } else if (turn.role === "tool-result") {
      const label = turn.isError ? `Tool result (${turn.name}, error)` : `Tool result (${turn.name})`;
      pendingClaudeParts.push(`**${label}:**\n\`\`\`\n${turn.body}\n\`\`\``);
    }
  }
  flushClaude();

  return md.join("\n");
}

function main() {
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID;
  if (!sessionId) {
    console.error("ERROR: CLAUDE_CODE_SESSION_ID is not set — this script must run inside a Claude Code session.");
    process.exit(1);
  }

  const outIndex = process.argv.indexOf("--out");
  const outPath = outIndex === -1 ? undefined : process.argv[outIndex + 1];
  if (!outPath) {
    console.error("Usage: node export-chatlog.mjs --out <path-to-markdown-file>");
    process.exit(1);
  }

  const transcriptPath = findTranscriptPath(sessionId);
  const turns = parseTranscript(transcriptPath);
  const rendered = renderMarkdown(turns, sessionId);
  const { markdown, counts } = redactSecrets(rendered);

  const totalRedactions = [...counts.values()].reduce((a, b) => a + b, 0);
  const finalMarkdown =
    totalRedactions === 0
      ? markdown
      : markdown.replace(
          /\n\n/,
          `\n\n> **${totalRedactions} potential secret(s) auto-redacted:** ${[...counts.entries()]
            .map(([name, n]) => `${name} × ${n}`)
            .join(", ")}. Heuristic scan only — still review the rest of this file for anything it missed before committing.\n\n`,
        );

  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, finalMarkdown, "utf8");
  console.log(`Chat log exported to ${outPath}`);
  if (totalRedactions > 0) {
    console.log(
      `Redacted ${totalRedactions} potential secret(s): ${[...counts.entries()]
        .map(([name, n]) => `${name} (${n})`)
        .join(", ")}`,
    );
  }
}

main();
