# mfdc

MFDC's internal Claude Code tooling, namespaced under `/mfdc:*`. Each skill
below is a separate slash command; add new MFDC-internal tools here as
additional skills rather than as new plugins, so everything stays under the
one namespace.

## Skills

### report-issue

Turns a chat discussion into a tracked, team-visible MFDC issue. See
`skills/report-issue/SKILL.md` for the full workflow; short version:

1. Separates the X/Y problem (what was literally asked vs. the underlying issue).
2. Exports the chat log (auto-redacting recognizable secret shapes) and
   writes a report + proposal doc, then commits all three locally — this runs
   straight through without stopping for input.
3. Gates on explicit confirmation before pushing.
4. Gates again before filing a Freedcamp issue and posting to Slack.

#### Requirements

This skill needs a deployed `report-issue-proxy` (source in this
marketplace's `infra/report-issue-proxy`) and four env vars set wherever it
runs, all sharing the `REPORT_ISSUE_PROXY_` prefix: `REPORT_ISSUE_PROXY_URL`,
`REPORT_ISSUE_PROXY_TOKEN`, `REPORT_ISSUE_PROXY_PROJECT_ID`,
`REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID`. It does not need, and should never be
given, the real Freedcamp API secret or Slack bot token — those live only as
Worker secrets on the proxy. See `infra/report-issue-proxy/README.md` for
deploy instructions.

#### Design notes

- `skills/report-issue/scripts/report-issue.mjs` and
  `skills/report-issue/scripts/export-chatlog.mjs` are Node-built-ins-only,
  deliberately dependency-free so this plugin never needs a `package.json` or
  `node_modules` installed alongside it.
- `export-chatlog.mjs` exists because skills can't invoke the interactive
  `/export` slash command directly — it reimplements just enough of it
  (locate this session's `.jsonl` transcript via `CLAUDE_CODE_SESSION_ID`,
  render to Markdown) to produce the chat-log export this skill commits. It
  also auto-redacts common secret shapes (API keys, tokens, private keys,
  `SECRET`/`TOKEN`/`PASSWORD`-style env assignments) as a heuristic pass —
  it's the only content-level check that runs; the user isn't asked to read
  the export before it's pushed, just to approve the push itself.
- The credential split (plugin holds a narrowly-scoped, rotatable proxy token;
  the proxy holds the real Freedcamp/Slack secrets) exists specifically because
  this is a *plugin* — meant to be installed into multiple repos/machines — and
  the real Freedcamp/Slack credentials should never travel with it.
- Slack posting uses the `chat.postMessage` Web API method with a bot token,
  not an Incoming Webhook, specifically so the caller can choose the channel
  per request (`REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID`) — webhooks are bound to
  one fixed channel at creation time.
