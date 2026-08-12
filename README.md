# MFDC agent marketplace

A Claude Code plugin marketplace for MFDC. Add it in Claude Code with:

```
/plugin marketplace add /home/user/hdd/src/mfdc/agent-marketplace
```

(or a git URL, once this is pushed somewhere) and then install individual
plugins with `/plugin install <plugin-name>@mfdc-agent-marketplace`.

## Structure

```
agent-marketplace/
├── .claude-plugin/
│   └── marketplace.json      # Catalog — lists every plugin below
├── plugins/
│   └── report-issue/         # A plugin: everything under .claude-plugin/plugin.json
│       ├── .claude-plugin/
│       │   └── plugin.json
│       └── skills/
│           └── report-issue/
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

`infra/` holds source for backend services that plugins depend on but that
aren't themselves Claude Code components (no commands/agents/skills/hooks) —
they don't appear in `marketplace.json`. `report-issue`, for instance, calls
out to a small Cloudflare Worker deployed from `infra/report-issue-proxy` so
the plugin never has to carry live Freedcamp/Slack credentials. See that
directory's own README for what it does and how to deploy it.

## Plugins

- **report-issue** — turns a chat discussion into a tracked MFDC issue: writes
  a report + proposal doc, exports the chat log, commits, files a Freedcamp
  issue, and posts it to Slack. Needs `infra/report-issue-proxy` deployed
  first (see that directory's README) and `REPORT_ISSUE_PROXY_URL` /
  `REPORT_ISSUE_PROXY_TOKEN` set wherever it runs.

## Adding a new plugin

1. `plugins/<name>/.claude-plugin/plugin.json` (see `plugins/report-issue` for
   a minimal example, or the `plugin-dev` plugin's `plugin-structure` skill for
   the full manifest reference).
2. Add commands/agents/skills/hooks under `plugins/<name>/` as needed.
3. Add an entry to `.claude-plugin/marketplace.json`'s `plugins` array with
   `"source": "./plugins/<name>"`.
4. If the plugin needs a backend service, put its source under `infra/`, not
   inside the plugin directory — plugin directories should only contain Claude
   Code components.
