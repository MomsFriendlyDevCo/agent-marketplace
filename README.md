# MFDC agent marketplace

A Claude Code plugin marketplace for MFDC. Add it in Claude Code with:

```
/plugin marketplace add MomsFriendlyDevCo/agent-marketplace
```

and then install individual plugins with
`/plugin install <plugin-name>@mfdc-agent-marketplace`.

## Structure

```
agent-marketplace/
├── .claude-plugin/
│   └── marketplace.json      # Catalog — lists every plugin below
├── plugins/
│   └── mfdc/                 # The plugin: everything under .claude-plugin/plugin.json
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           └── report-issue/ # One skill — /mfdc:report-issue in the / menu
│               ├── SKILL.md
│               └── scripts/
│                   └── report-issue.mjs
└── infra/
    └── report-issue-proxy/   # NOT a plugin component — supporting backend
        └── ...               # service some plugins call over HTTP
```

`.claude-plugin/marketplace.json` is the catalog Claude Code reads to list what's
installable. Each entry's `source` points at a directory under `plugins/`
(`"./plugins/<name>"`) — this marketplace bundles its plugins in the same repo
rather than pointing out to separate ones, since they're all MFDC-internal.

Slash-command namespacing in the `/` menu comes from the plugin's `name`, as
`/<plugin-name>:<skill-name>` — not from anything set in `settings.json`. All
MFDC-internal tools live as skills inside the single `mfdc` plugin (rather than
one plugin per tool) so they all land under the shared `/mfdc:*` prefix; only
split a tool into its own plugin if it genuinely needs independent
install/enable semantics from the rest.

`infra/` holds source for backend services that plugins depend on but that
aren't themselves Claude Code components (no commands/agents/skills/hooks) —
they don't appear in `marketplace.json`. `report-issue`, for instance, calls
out to a small Cloudflare Worker deployed from `infra/report-issue-proxy` so
the plugin never has to carry live Freedcamp/Slack credentials. See that
directory's own README for what it does and how to deploy it.

## Plugins

- **mfdc** — MFDC's internal tooling, namespaced under `/mfdc:*`. Currently
  one skill:
  - **report-issue** (`/mfdc:report-issue`) — turns a chat discussion into a
    tracked MFDC issue: writes a report + proposal doc, exports the chat log,
    commits, files a Freedcamp issue, and posts it to Slack. Needs
    `infra/report-issue-proxy` deployed first (see that directory's README)
    and `REPORT_ISSUE_PROXY_URL` / `REPORT_ISSUE_PROXY_TOKEN` /
    `REPORT_ISSUE_PROXY_PROJECT_ID` set wherever it runs.

## Adding a new tool

Most new MFDC-internal tools should become a new **skill** inside the
existing `mfdc` plugin, so they land under the shared `/mfdc:*` namespace
rather than each claiming their own:

1. Add the skill under `plugins/mfdc/skills/<name>/` (see
   `plugins/mfdc/skills/report-issue` for a working example, or the
   `plugin-dev` plugin's `skill-development` skill for the full reference).
2. Update `plugins/mfdc/README.md` and `plugins/mfdc/.claude-plugin/plugin.json`'s
   description to mention it.
3. If it needs a backend service, put its source under `infra/`, not inside
   the plugin directory — plugin directories should only contain Claude Code
   components.

Only create a genuinely new **plugin** (a new entry in
`.claude-plugin/marketplace.json` with its own `plugins/<name>/`) if the tool
needs independent install/enable semantics from the rest of `mfdc` — e.g. it's
meant to be enabled/disabled separately, or shouldn't share the `/mfdc:*`
namespace for some reason.
