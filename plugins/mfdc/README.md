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
2. Exports the chat log and writes a report + proposal doc — user reviews both
   before anything is committed.
3. Commits locally, then gates on explicit confirmation before pushing.
4. Gates again before filing a Freedcamp issue and posting to Slack.

#### Requirements

This skill needs a deployed `report-issue-proxy` (source in this
marketplace's `infra/report-issue-proxy`) and three env vars set wherever it
runs, all sharing the `REPORT_ISSUE_PROXY_` prefix: `REPORT_ISSUE_PROXY_URL`,
`REPORT_ISSUE_PROXY_TOKEN`, `REPORT_ISSUE_PROXY_PROJECT_ID`. It does not need,
and should never be given, the real Freedcamp API secret or Slack webhook URL
— those live only as Worker secrets on the proxy. See
`infra/report-issue-proxy/README.md` for deploy instructions.

#### Design notes

- `skills/report-issue/scripts/report-issue.mjs` is Node-built-ins-only,
  deliberately dependency-free so this plugin never needs a `package.json` or
  `node_modules` installed alongside it.
- The credential split (plugin holds a narrowly-scoped, rotatable proxy token;
  the proxy holds the real Freedcamp/Slack secrets) exists specifically because
  this is a *plugin* — meant to be installed into multiple repos/machines — and
  the real Freedcamp/Slack credentials should never travel with it.
