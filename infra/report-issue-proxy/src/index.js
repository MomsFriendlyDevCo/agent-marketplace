/**
 * Proxy for the report-issue skill of the mfdc plugin (plugins/mfdc in this
 * marketplace repo). Holds the real Freedcamp/Slack credentials as Worker
 * secrets so the plugin itself never carries them — callers authenticate with
 * PROXY_AUTH_TOKEN, a narrowly-scoped, independently-rotatable value that only
 * grants "create a Freedcamp issue + post one Slack message", not general
 * Freedcamp/Slack account access. Note this scope now includes the caller's
 * choice of `project_id` and `slack_channel_id` — the token authorizes issue
 * creation in ANY project the Freedcamp API key can see, and a message post
 * to ANY channel the Slack bot has access to, not just one fixed project/
 * channel, since a single proxy deployment is meant to serve every
 * project/channel a team files issues from.
 *
 * Slack posting uses the `chat.postMessage` Web API method (a bot token,
 * not an Incoming Webhook) specifically because Incoming Webhooks are bound
 * to one fixed channel at creation time and can't take a per-request
 * channel — see the "Scope of PROXY_AUTH_TOKEN" section in README.md.
 *
 * Deploy: wrangler secret put <NAME> for each of the four secrets below, then
 * `npx wrangler deploy` (see README.md in this directory).
 */

const FREEDCAMP_BASE = "https://freedcamp.com/api/v1";

const ISSUE_TYPE_BY_FLAG = { fix: "Bug", feature: "Feature", refactor: "Task" };
const PRIORITY_BY_FLAG = { low: 1, medium: 2, high: 3 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function timingSafeTokenMatch(a, b) {
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  if (bufA.byteLength !== bufB.byteLength) return false;
  return crypto.subtle.timingSafeEqual(bufA, bufB);
}

async function freedcampAuthParams(apiKey, apiSecret) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(apiKey + timestamp));
  const hash = [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { api_key: apiKey, timestamp, hash };
}

function mapType(type) {
  const mapped = ISSUE_TYPE_BY_FLAG[type];
  if (!mapped) throw new Error(`unreachable: unmapped type ${type}`);
  return mapped;
}

function mapPriority(priority) {
  const mapped = PRIORITY_BY_FLAG[priority];
  if (!mapped) throw new Error(`unreachable: unmapped priority ${priority}`);
  return mapped;
}

async function createFreedcampIssue(env, req) {
  const auth = await freedcampAuthParams(env.FREEDCAMP_API_KEY, env.FREEDCAMP_API_SECRET);
  const body = new URLSearchParams({
    ...auth,
    title: req.title,
    description: req.description,
    project_id: String(req.project_id),
    type: mapType(req.type),
    priority: String(mapPriority(req.priority)),
  });

  const res = await fetch(`${FREEDCAMP_BASE}/issues`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const responseJson = await res.json().catch(() => null);

  if (!res.ok || !responseJson || responseJson.error_id) {
    throw new Response(
      JSON.stringify({ ok: false, stage: "freedcamp", status: res.status, body: responseJson }, null, 2),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
  const issue = responseJson.data?.issues?.[0];
  return { id: issue?.id, url: issue?.url };
}

async function postToSlack(env, channelId, text) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const body = await res.json().catch(() => null);

  // chat.postMessage returns HTTP 200 even on failure (e.g. bad channel,
  // missing scope) — the real result is in the JSON body's `ok` field, not
  // the status code.
  if (!res.ok || !body?.ok) {
    throw new Response(
      JSON.stringify({ ok: false, stage: "slack", status: res.status, body }, null, 2),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
}

function isValidRequest(value) {
  if (typeof value !== "object" || value === null) return false;
  return (
    typeof value.title === "string" &&
    value.title.length > 0 &&
    typeof value.description === "string" &&
    value.description.length > 0 &&
    (typeof value.project_id === "string" || typeof value.project_id === "number") &&
    String(value.project_id).length > 0 &&
    typeof value.slack_channel_id === "string" &&
    value.slack_channel_id.length > 0 &&
    typeof value.type === "string" &&
    value.type in ISSUE_TYPE_BY_FLAG &&
    typeof value.priority === "string" &&
    value.priority in PRIORITY_BY_FLAG
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/report-issue") return json({ ok: false, error: "not found" }, 404);
    if (request.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

    const authHeader = request.headers.get("Authorization") ?? "";
    const [scheme, token] = authHeader.split(" ");
    if (scheme !== "Bearer" || !token) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    // Keyed on the token itself: bounds how many issues/Slack posts a single
    // (possibly leaked, but cryptographically infeasible to guess) token can
    // trigger, independent of whether the compare below succeeds — a
    // reused-after-leak token gets capped the same as a legitimate one going
    // rogue, not just blind guessing attempts.
    const { success: withinRateLimit } = await env.AUTH_RATE_LIMITER.limit({ key: token });
    if (!withinRateLimit) {
      return json({ ok: false, error: "rate limited" }, 429);
    }

    if (!(await timingSafeTokenMatch(token, env.PROXY_AUTH_TOKEN))) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: "invalid JSON body" }, 400);
    }
    if (!isValidRequest(payload)) {
      return json(
        {
          ok: false,
          error:
            "body must be { title, description, project_id, slack_channel_id, type: fix|feature|refactor, priority: low|medium|high }",
        },
        400,
      );
    }

    try {
      const issue = await createFreedcampIssue(env, payload);
      const freedcampUrl = issue.url ?? `(no url in response — check id ${issue.id} manually)`;

      await postToSlack(
        env,
        payload.slack_channel_id,
        [`:mega: New issue filed to Freedcamp: *${payload.title}*`, freedcampUrl].join("\n"),
      );

      return json({ ok: true, freedcampUrl, freedcampIssueId: issue.id });
    } catch (e) {
      if (e instanceof Response) return e;
      return json({ ok: false, error: String(e) }, 500);
    }
  },
};
