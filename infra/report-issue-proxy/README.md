# report-issue proxy

Cloudflare Worker that holds the real Freedcamp/Slack credentials for the
`report-issue` plugin (`plugins/report-issue` in this marketplace repo) so
those credentials never have to travel with the plugin itself, wherever it
gets installed. The plugin only needs this Worker's URL and a
`PROXY_AUTH_TOKEN` — a value scoped to "create one Freedcamp issue + post one
Slack message", independently rotatable, and much lower-stakes than the
Freedcamp API secret or the Slack webhook URL it protects.

See `src/index.js` for the implementation: `POST /report-issue` with a
`{ title, description, type, priority }` JSON body and an
`Authorization: Bearer <PROXY_AUTH_TOKEN>` header.

## One-time deploy

```bash
cd infra/report-issue-proxy
npm install
npx wrangler login              # ties this deploy to a Cloudflare account

# Generate the proxy token first — this is the ONLY value that gets handed to
# teammates/the plugin. Keep it out of git.
openssl rand -hex 32

npx wrangler secret put PROXY_AUTH_TOKEN       # paste the value above
npx wrangler secret put FREEDCAMP_API_KEY      # from Freedcamp Settings > API
npx wrangler secret put FREEDCAMP_API_SECRET
npx wrangler secret put FREEDCAMP_PROJECT_ID   # numeric project_id
npx wrangler secret put SLACK_WEBHOOK_URL      # Slack Incoming Webhook URL

npx wrangler deploy
```

`wrangler deploy` prints the Worker's URL
(`https://nmc-report-issue-proxy.<your-subdomain>.workers.dev`). That URL is
not secret — hand it out along with the `PROXY_AUTH_TOKEN` to anyone who needs
to run the report-issue skill, as:

```
REPORT_ISSUE_PROXY_URL=https://nmc-report-issue-proxy.<subdomain>.workers.dev
REPORT_ISSUE_PROXY_TOKEN=<the token>
```

either in their shell env or in a local `.env` (the plugin script walks up
from its current directory looking for one). Neither value is the real
Freedcamp/Slack credential, so ordinary secret-sharing hygiene (not committing
it to git) is enough — it doesn't need the same handling as the Freedcamp
secret itself.

## Rotating the proxy token

If `PROXY_AUTH_TOKEN` ever leaks (e.g. the plugin circulates further than
intended): generate a new one, `wrangler secret put PROXY_AUTH_TOKEN` again,
redeploy is not required (secrets apply immediately), and redistribute the new
value. The Freedcamp/Slack credentials themselves are untouched — that's the
whole point of the split.

## Distributing the URL/token with the plugin itself

The whole reason this proxy exists is so the plugin can ship with *something*
baked in instead of requiring per-machine secret setup. Two different calls:

- **`REPORT_ISSUE_PROXY_URL`** — not a secret. Safe to hardcode as a default
  in `.agents/skills/report-issue/scripts/report-issue.mjs` once deployed
  (still overridable via env var, e.g. to point at a local `wrangler dev`
  instance while testing).
- **`REPORT_ISSUE_PROXY_TOKEN`** — still a live credential. Baking it into the
  plugin/repo means anyone with access to the plugin can trigger real
  Freedcamp issues and Slack posts (bounded to that one action, and instantly
  revocable by rotation — but real). `AUTH_RATE_LIMITER` (20 req/60s, keyed on
  the token) exists specifically to bound the damage if this is done: it caps
  how much a leaked token can be abused before someone notices, rather than
  preventing embedding altogether. Whether to actually commit a real token to
  the plugin is a call about how far you expect the plugin to circulate — not
  something to default into without deciding that explicitly.

## Local development

```bash
npx wrangler dev
```

Runs the Worker locally without touching the real secrets (pass `--var
NAME:value` for each of the five env vars to exercise it against
fakes/sandboxes — real Freedcamp calls will still go out over the network,
so use throwaway values or a project you don't mind test-posting to).

## Notes

- The Freedcamp auth scheme (HMAC-SHA1 of `api_key + timestamp`, keyed by the
  secret) and the `POST /issues` response shape were confirmed empirically:
  a local `wrangler dev` run with fake credentials produced a real
  `"Passed API key is invalid"` response from Freedcamp's actual API, so the
  endpoint/request shape is right — only the credential values need to be real.
- `AUTH_RATE_LIMITER` (`wrangler.jsonc`, 20 requests/60s per token) caps abuse
  of a single token — confirmed locally: 20 requests return 401 (wrong test
  token), the 21st onward return 429. This does not replace rotation if a
  token actually leaks, it just bounds the damage in the meantime.
