# report-issue proxy

Cloudflare Worker that holds the real Freedcamp/Slack credentials for the
`report-issue` skill of the `mfdc` plugin (`plugins/mfdc` in this marketplace
repo) so those credentials never have to travel with the plugin itself,
wherever it gets installed. The plugin only needs this Worker's URL and a
`PROXY_AUTH_TOKEN` — a value scoped to "create a Freedcamp issue in a
caller-chosen project + post one Slack message to a caller-chosen channel",
independently rotatable, and much lower-stakes than the Freedcamp API secret
or the Slack bot token it protects. See "Scope of `PROXY_AUTH_TOKEN`" below
for exactly what that scope covers.

See `src/index.js` for the implementation: `POST /report-issue` with a
`{ title, description, project_id, slack_channel_id, type, priority }` JSON
body and an `Authorization: Bearer <PROXY_AUTH_TOKEN>` header. `project_id`
and `slack_channel_id` are both supplied by the caller (not baked into the
Worker), so one deployed proxy can serve every project/channel a team files
issues from — see "Scope of `PROXY_AUTH_TOKEN`" below for what that means for
the token.

Slack posting goes through the `chat.postMessage` Web API method (a bot
token), not an Incoming Webhook — webhooks are bound to one fixed channel at
creation time and have no per-request channel parameter, so they can't
support a caller-chosen channel.

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
npx wrangler secret put SLACK_BOT_TOKEN        # xoxb-... bot token, chat:write scope

npx wrangler deploy
```

`SLACK_BOT_TOKEN` comes from a Slack App's **OAuth & Permissions** page (Bot
Token Scopes), not the "Incoming Webhooks" feature — add the `chat:write`
scope so the bot can call `chat.postMessage`, and `chat:write.public` too if
you want it to post into public channels it hasn't been explicitly invited
to. Without `chat:write.public`, invite the bot to each channel it needs to
post into (`/invite @your-bot-name` in that channel) or the post fails with a
`not_in_channel` error.

`wrangler deploy` prints the Worker's URL
(`https://nmc-report-issue-proxy.<your-subdomain>.workers.dev`). That URL is
not secret — hand it out along with the `PROXY_AUTH_TOKEN` to anyone who needs
to run the report-issue skill, as:

```
REPORT_ISSUE_PROXY_URL=https://nmc-report-issue-proxy.<subdomain>.workers.dev
REPORT_ISSUE_PROXY_TOKEN=<the token>
REPORT_ISSUE_PROXY_PROJECT_ID=<numeric Freedcamp project_id for this repo>
REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID=<Slack channel ID to post issues to>
```

either in their shell env or in a local `.env` (the plugin script walks up
from its current directory looking for one). All four client-side vars share
the `REPORT_ISSUE_PROXY_` prefix. `REPORT_ISSUE_PROXY_PROJECT_ID` and
`REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID` are per-repo, not secrets — fine to
commit in a project's own `.env` so every contributor files into the right
Freedcamp project and Slack channel without configuring it themselves
(`REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID` is a channel ID like `C0123456789`,
not a channel name — find it via "Copy channel ID" in Slack's channel details
panel). Neither `_URL`, `_PROJECT_ID`, nor `_SLACK_CHANNEL_ID` is the real
Freedcamp/Slack credential, so ordinary secret-sharing hygiene (not
committing `_TOKEN` to git) is enough — the token doesn't need the same
handling as the Freedcamp secret itself, but it's still a live credential (see
below).

## Scope of `PROXY_AUTH_TOKEN`

`project_id` and `slack_channel_id` are both part of the request body the
caller sends, not Worker secrets — one deployed proxy serves every
project/channel a team files issues into, rather than needing a separate
deployment per project or channel. The consequence: `PROXY_AUTH_TOKEN`
authorizes issue creation in **any** project the `FREEDCAMP_API_KEY` can see,
and a message post to **any** channel the `SLACK_BOT_TOKEN`'s bot user can
reach (every channel it's a member of, plus every public channel if
`chat:write.public` is granted). A leaked token can't read anything (see
`src/index.js` — the only Freedcamp call it makes is `POST /issues`, the only
Slack call is `chat.postMessage`), but it can be used to spam-create issues
across every project the Freedcamp account has access to, and to post
arbitrary messages into any channel the bot can reach. `AUTH_RATE_LIMITER`
bounds the volume; it doesn't bound which projects or channels. If that's too
broad for how your team uses Freedcamp/Slack, deploy separate proxy instances
(and tokens) per project/channel instead of sharing one.

## Rotating the proxy token

If `PROXY_AUTH_TOKEN` ever leaks (e.g. the plugin circulates further than
intended): generate a new one, `wrangler secret put PROXY_AUTH_TOKEN` again,
redeploy is not required (secrets apply immediately), and redistribute the new
value. The Freedcamp/Slack credentials themselves are untouched — that's the
whole point of the split.

## Distributing the URL/token with the plugin itself

The whole reason this proxy exists is so the plugin can ship with *something*
baked in instead of requiring per-machine secret setup. Four different calls:

- **`REPORT_ISSUE_PROXY_URL`** — not a secret. Safe to hardcode as a default
  in `plugins/mfdc/skills/report-issue/scripts/report-issue.mjs` once deployed
  (still overridable via env var, e.g. to point at a local `wrangler dev`
  instance while testing).
- **`REPORT_ISSUE_PROXY_PROJECT_ID`** and **`REPORT_ISSUE_PROXY_SLACK_CHANNEL_ID`**
  — also not secrets, but repo-specific: they should match the Freedcamp
  project and Slack channel that repo's issues belong in, so they're best
  committed per-repo rather than baked into the plugin itself.
- **`REPORT_ISSUE_PROXY_TOKEN`** — still a live credential. Baking it into the
  plugin/repo means anyone with access to the plugin can trigger real
  Freedcamp issues and Slack posts in any project/channel the credentials can
  reach (instantly revocable by rotation — but real; see "Scope of
  `PROXY_AUTH_TOKEN`" above).
  `AUTH_RATE_LIMITER` (20 req/60s, keyed on the token) exists specifically to
  bound the damage if this is done: it caps how much a leaked token can be
  abused before someone notices, rather than preventing embedding altogether.
  Whether to actually commit a real token to the plugin is a call about how
  far you expect the plugin to circulate — not something to default into
  without deciding that explicitly.

## Local development

```bash
npx wrangler dev
```

Runs the Worker locally without touching the real secrets (pass `--var
NAME:value` for each of the four Worker secrets to exercise it against
fakes/sandboxes — real Freedcamp/Slack calls will still go out over the
network, so use throwaway credential values, and send a `project_id` and
`slack_channel_id` in the test request body for a project/channel you don't
mind test-posting to).

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
- The `chat.postMessage` request shape (JSON body, `Authorization: Bearer`,
  checking the response body's `ok` field rather than the HTTP status) matches
  Slack's documented Web API contract, but — unlike the Freedcamp call above —
  it has not yet been empirically verified against a real bot token. Smoke
  test with a real `SLACK_BOT_TOKEN` and a channel the bot is in before
  relying on this unattended; watch specifically for `not_in_channel` (bot not
  invited, and `chat:write.public` not granted) and `missing_scope`.
