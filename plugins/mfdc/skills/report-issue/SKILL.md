---
name: report-issue
description: Packages up a bug/feature/refactor discussed in this session into a chat-log export, a report, and a proposal, commits them, files a Freedcamp issue, and posts it to Slack. Use when the user asks to "report this to MFDC", "file an issue", "log this for the team", or similar — not for routine code changes that don't need external tracking.
version: 1.0.0
---

# Report an issue to MFDC

This turns a chat discussion into a tracked, team-visible issue: three files
committed to the repo (a chat-log export, an initial report, and a proposal), a
Freedcamp issue, and a Slack post — all three files are required output, not
optional extras. Steps 0–4 are local and reversible — run them back-to-back
without stopping for input in between (only pausing where a step itself says
to ask, because it genuinely can't proceed without an answer). Once
committed, push is the one remaining gate — **do not push without an
explicit go-ahead** from the user, even in an otherwise autonomous session.
Filing the Freedcamp issue and posting to Slack are not a second decision:
they happen automatically, every time, as soon as the push does. Don't ask
about them separately.

## 0. Confirm scope

If it's not already obvious from the conversation, ask the user (in one line)
what's being reported. If the fix/feature/refactor classification isn't
already obvious either, use `AskUserQuestion` for it (options: fix / feature /
refactor) rather than a free-text ask — it's a small, enumerable choice and
this is the one point where getting it wrong quietly derails the rest of the
skill. Don't guess silently — the classification drives the Freedcamp `type`
and the title prefix.

## 1. Separate the X/Y problem

Before writing anything, work out — and show the user — two things:

- **X — what was asked for**: the literal request or proposed solution as stated
  (e.g. "remove the sign-in banner on Report Access").
- **Y — the underlying problem**: what's actually broken or missing that prompted
  the ask (e.g. "the Report Access button has no working destination for signed-out
  users, so the banner is the only symptom currently visible").

There's no question to ask here — X and Y are always both captured, not
alternatives to pick between. Users describe problems as solutions ("make the
button use FOO technology!!!") when the actual need is narrower or different
("make the button blue"); this step's job is to pull those apart and write
down both, every time, regardless of whether they turn out to differ. This
block becomes the top of the initial-report doc.

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
same as the poster script in step 5.

The script auto-redacts common secret shapes it recognizes (API keys, tokens,
private keys, `SECRET`/`TOKEN`/`PASSWORD`/`KEY`-style env assignments, etc.),
replacing each with a `[REDACTED:<kind>]` marker, and prints a summary of what
it redacted — check the console output. If it redacted anything, it also adds
a note at the top of the file itself.

Don't stop here — continue straight to step 3. This auto-redaction is a
heuristic pass, not a guarantee: it only catches recognizable formats, not
freeform secrets (a raw password with no label, an internal customer
identifier, someone's name). It's still the only content-level check that
runs, though — the user isn't asked to read the export at the push gate (step
5), just to approve pushing. Keep `REDACTION_RULES` (in the script) current as
new secret shapes come up rather than counting on a human catching what it
misses.

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
  - Classification: CHORE / DOCS / FEATURE / FIX / REFACTOR / TEST
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

## 5. Gate: push (Freedcamp + Slack follow automatically)

This is the first stop since step 0 — show the user the commit (`git show
--stat`) and the step 2 auto-redaction summary (what was found, if anything),
then use `AskUserQuestion` (options: push now / hold off) rather than waiting
for a typed go-ahead. Don't ask them to open and read through the export or
the docs themselves — the auto-redaction pass is the content check; the ask
here is just "OK to push?", not "please review this." This is the **only**
question in this step — filing the Freedcamp issue and posting to Slack are
not held on a second ask; they follow the push automatically, every time.

Once approved:

1. Push (`git push`), then derive the commit URL from `git remote get-url
   origin` (strip a trailing `.git`; if it's an SSH-style
   `git@host:org/repo`, convert to `https://host/org/repo`) plus
   `/commit/<sha>`. Don't assume any particular host or org — read it from
   the repo each time.
2. Immediately run the poster script (from the repo root, so relative
   `--report`/`--proposal` paths resolve — the script itself is referenced
   via `${CLAUDE_PLUGIN_ROOT}`, not a repo-relative path, since the plugin is
   installed outside the working repo) for real, with `--yes` so the
   script's own interactive confirmation doesn't stop and wait for a second
   answer that was already given by the push approval above:

```
node ${CLAUDE_PLUGIN_ROOT}/skills/report-issue/scripts/report-issue.mjs \
  --title "<short title>" \
  --type fix|feature|refactor \
  --report docs/<PREFIX>_ISSUE-REPORT-<SLUG>.md \
  --proposal docs/<PREFIX>_ISSUE-PROPOSAL-<SLUG>.md \
  --commit-url <commit URL from step 5.1> \
  --priority low|medium|high \
  --yes
```

The script requires `REPORT_ISSUE_PROXY_URL`, `REPORT_ISSUE_PROXY_TOKEN`,
`REPORT_ISSUE_PROXY_PROJECT_ID`, and `REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID`
(all sharing the `REPORT_ISSUE_PROXY_` prefix; the last two are the numeric
Freedcamp project and the Slack channel ID to file/post into and, unlike the
token, aren't secrets) already present in `process.env` when it runs. The
script does not load any `.env`-style file itself and has no opinion on
dotenv filenames — loading these vars into the environment is the calling
project's own responsibility, using whatever mechanism that project already
uses for its env config. Since each poster-script invocation above is its own
shell command, make sure that command itself ends up with the vars loaded
(e.g. source the project's env files, or run through the project's own
env-aware task runner, in the same command as the `node` call — a var
exported in an earlier, separate command will not carry over). It does
**not** need the real Freedcamp/Slack credentials —
those live only as Worker secrets on a separately-deployed proxy (source in this
plugin's marketplace repo, under `infra/report-issue-proxy`; see that
directory's README for deploy/rotation). If the proxy vars are unset it fails
loudly rather than silently skipping — if that happens, stop and use
`AskUserQuestion` to ask how to proceed (options: I'll provide the value now
[falls through to the "Other" free-text slot for the actual value] / check
with whoever deployed the proxy / show me the deploy README) rather than
working around it or guessing.

## 6. Report back

Once done, give the user: the Freedcamp ticket number and URL, the commit URL, and
the paths of all three committed files (chat-log export, report, proposal). The
ticket number is the project-prefixed one (e.g. `NMC-1234`, printed by the
script as `Freedcamp issue NMC-1234 (#<id>): <url>`), not the bare numeric id
in parentheses — that prefixed form is what the team actually uses in
Freedcamp/Slack, so it's the reference to quote whenever the item comes up
again, when following up in Slack/Freedcamp, or when linking back to this
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
  it's necessarily incomplete, and the user isn't asked to read the export
  themselves before it's pushed (step 5) — this list is the only content-level
  check that runs. Keep it current as new secret shapes come up.
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
