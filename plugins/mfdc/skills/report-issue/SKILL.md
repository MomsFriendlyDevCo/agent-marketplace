---
name: report-issue
description: Packages up a bug/feature/refactor discussed in this session into a chat-log export, a report, and a proposal, commits them, files a Freedcamp issue, and posts it to Slack. Use when the user asks to "report this to MFDC", "file an issue", "log this for the team", or similar — not for routine code changes that don't need external tracking.
version: 1.0.0
---

# Report an issue to MFDC

This turns a chat discussion into a tracked, team-visible issue: three files
committed to the repo (a chat-log export, an initial report, and a proposal), a
Freedcamp issue, and a Slack post — all three files are required output, not
optional extras. The last three steps are visible to other people and hard to
undo — **do not run them without an explicit go-ahead** from the user at each
gate below, even in an otherwise autonomous session.

## 0. Confirm scope

If it's not already obvious from the conversation, ask the user (in one line)
what's being reported and whether it's a fix, feature, or refactor. Don't guess
silently — the classification drives the Freedcamp `type` and the title prefix.

## 1. Separate the X/Y problem

Before writing anything, work out — and show the user — two things:

- **X — what was asked for**: the literal request or proposed solution as stated
  (e.g. "remove the sign-in banner on Report Access").
- **Y — the underlying problem**: what's actually broken or missing that prompted
  the ask (e.g. "the Report Access button has no working destination for signed-out
  users, so the banner is the only symptom currently visible").

If X and Y differ, say so explicitly and ask the user which one to file — reporting
only the literal ask (X) when the real gap is Y produces a fix that satisfies the
ticket but not the actual need. This block becomes the top of the initial-report doc.

## 2. Export the chat log

First work out today's `<PREFIX>`: `YYYYMMDD-NNN`, where `YYYYMMDD` is today's
date and `NNN` is a zero-padded, per-day sequence number. Find `NNN` by
scanning `docs/` and `docs/exports/` (creating the latter first if the repo
doesn't already have it) for existing filenames starting with today's
`YYYYMMDD-`, taking the highest `NNN` found, and incrementing it — start at
`001` if none exist for today. Use the same `<PREFIX>` for all three files
produced in this and the next step, so they're grouped together by filename.

Run the export script (a skill can't invoke the interactive `/export` slash
command directly, so this reimplements the part of it needed here) targeting
`docs/exports/<PREFIX>_<SLUG>-chatlog.md`. Use a short kebab-case `<SLUG>` for
the issue:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/report-issue/scripts/export-chatlog.mjs \
  --out docs/exports/<PREFIX>_<SLUG>-chatlog.md
```

Run it from the repo root so the `--out` path resolves relative to the repo,
same as the poster script in step 6.

The script auto-redacts common secret shapes it recognizes (API keys, tokens,
private keys, `SECRET`/`TOKEN`/`PASSWORD`/`KEY`-style env assignments, etc.),
replacing each with a `[REDACTED:<kind>]` marker, and prints a summary of what
it redacted — check the console output. If it redacted anything, it also adds
a note at the top of the file itself.

**Stop and show the user the exported file path before going further.** This
auto-redaction is a heuristic, defense-in-depth pass, not a guarantee — it
only catches recognizable formats, not freeform secrets (a raw password with
no label, an internal customer identifier, someone's name). A full session
transcript can still contain pasted secrets, tokens, or other people's names —
ask the user to skim it and tell you to redact or trim anything before it's
committed. Do not commit it unreviewed.

## 3. Write the two docs

Check whether the repo already has a convention for standalone docs (a flat
`docs/` directory with a naming pattern, an `rfcs/` folder, etc.) and follow it.
If there's no existing convention, default to:

- `docs/<PREFIX>_ISSUE-REPORT-<SLUG>.md` — the initial report:
  - The X/Y block from step 1
  - Reported by / date
  - Reproduction steps or evidence, if any (screenshots, logs, quoted messages)
  - Current vs expected behaviour
- `docs/<PREFIX>_ISSUE-PROPOSAL-<SLUG>.md` — the proposed change:
  - Classification: Fix / Feature / Refactor
  - Proposed approach
  - Files/areas affected
  - Risks, alternatives considered
  - Validation plan (how you'd confirm it worked)

Keep both grounded in what was actually discussed — don't invent scope the
conversation didn't cover.

## 4. Commit (local only)

Stage **only** the three new files (the two docs + the chat-log export) —
never `git add -A` here, since unrelated in-progress changes may be sitting in
the working tree. Commit locally with a plain, factual message. Do not push yet.

## 5. Gate: push

Show the user the commit (`git show --stat`) and ask before pushing — pushing is
what makes the commit link in the Freedcamp issue resolve, and it's a shared-state
action. Once approved, push and derive the commit URL from `git remote get-url
origin` (strip a trailing `.git`; if it's an SSH-style
`git@host:org/repo`, convert to `https://host/org/repo`) plus `/commit/<sha>`.
Don't assume any particular host or org — read it from the repo each time.

## 6. Gate: Freedcamp + Slack

Run the poster script (from the repo root, so relative `--report`/`--proposal`
paths resolve — the script itself is referenced via `${CLAUDE_PLUGIN_ROOT}`,
not a repo-relative path, since the plugin is installed outside the working
repo) in `--dry-run` first and show the user the exact preview (title, type,
priority, commit link) it prints:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/report-issue/scripts/report-issue.mjs \
  --title "<short title>" \
  --type fix|feature|refactor \
  --report docs/<PREFIX>_ISSUE-REPORT-<SLUG>.md \
  --proposal docs/<PREFIX>_ISSUE-PROPOSAL-<SLUG>.md \
  --commit-url <commit URL from step 5> \
  --priority low|medium|high \
  --dry-run
```

Only after the user confirms the preview, re-run the same command **without**
`--dry-run`. The script itself will also ask for interactive confirmation unless
`--yes` is passed — leave that prompt in place rather than passing `--yes`, it's
the last checkpoint before the issue goes live and Slack fires.

The script requires `REPORT_ISSUE_PROXY_URL`, `REPORT_ISSUE_PROXY_TOKEN`, and
`REPORT_ISSUE_PROXY_PROJECT_ID` (all sharing the `REPORT_ISSUE_PROXY_` prefix;
the last is the numeric Freedcamp project to file into and, unlike the token,
isn't a secret — it's fine to commit in this repo's own `.env`), set in the
shell or in a `.env` file (it auto-loads one by walking up from the current
directory). It does **not** need the real Freedcamp/Slack credentials —
those live only as Worker secrets on a separately-deployed proxy (source in this
plugin's marketplace repo, under `infra/report-issue-proxy`; see that
directory's README for deploy/rotation). If the proxy vars are unset it fails
loudly rather than silently skipping — if that happens, stop and ask the user
for the missing value (or whoever deployed the proxy) rather than working
around it.

## 7. Report back

Once done, give the user: the Freedcamp issue number and URL, the commit URL, and
the paths of all three committed files (chat-log export, report, proposal). The
issue number (e.g. `#1234`, printed by the script as `Freedcamp issue #<id>:
<url>`) is the reference to use whenever the item comes up again — quote it when following up in Slack/Freedcamp or linking back to this
work later, rather than re-describing the issue. Don't summarize further than
that unless asked.

## Notes

- `scripts/report-issue.mjs` and `scripts/export-chatlog.mjs` are the only
  files in this skill with executable logic — both are deliberately
  dependency-free (Node built-ins only), which is what lets this plugin ship
  without a package.json or node_modules along. Don't add npm dependencies to
  either; if you need something a built-in doesn't cover, implement it inline.
- `export-chatlog.mjs` locates the current transcript via the
  `CLAUDE_CODE_SESSION_ID` env var (set by Claude Code for every session), not
  by scanning `~/.claude/projects/` for the most-recently-modified file — that
  would pick the wrong transcript whenever more than one Claude Code session
  is open at once.
- `export-chatlog.mjs`'s `REDACTION_RULES` list is pattern-based (regex), so
  it's necessarily incomplete — add new rules there as new secret shapes come
  up, but don't treat it as a reason to skip the human-review gate below.
- It does not talk to Freedcamp/Slack directly — it posts to a report-issue
  proxy Worker (source: this marketplace repo's `infra/report-issue-proxy`,
  deployed separately from wherever this plugin gets installed), which holds
  the real credentials. This split exists so the plugin can be handed out
  without the Freedcamp API secret or Slack webhook URL traveling with it; only
  a narrowly-scoped, independently-rotatable proxy token does. See
  `infra/report-issue-proxy/README.md` for the deploy/rotation story — that
  Worker's HMAC/endpoint logic was verified empirically (a local `wrangler dev`
  run with fake credentials produced a real "invalid API key" response from
  Freedcamp's live API), but the proxy's `type`/`priority` mapping should still
  be spot-checked against a real Freedcamp project before relying on it
  unattended.
- If a step in this skill conflicts with something the user says in the moment
  (e.g. they want to skip the doc-writing step for a trivial report), follow the
  user — this is a default workflow, not a rigid one.
