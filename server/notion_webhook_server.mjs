import crypto from "node:crypto";
import http from "node:http";
import { getConfig, syncByPageId, validateConfig } from "../scripts/notion_snippet_sync_core.mjs";

const PORT = Number(process.env.PORT || 8787);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || "/notion-webhook";
const WEBHOOK_SECRET = process.env.NOTION_WEBHOOK_SECRET || "";
const WEBHOOK_VERIFICATION_TOKEN = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN || "";

const cfg = getConfig();
validateConfig(cfg);

const seenEventIds = new Set();

function parseJson(raw) {
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

function cleanSignature(sig) {
  if (!sig) return "";
  const val = String(sig).trim();
  if (val.startsWith("sha256=")) return val.slice(7);
  if (val.startsWith("v1=")) return val.slice(3);
  return val;
}

function verifySignature(rawBody, headers) {
  if (!WEBHOOK_SECRET) return true;

  const provided = cleanSignature(headers["x-notion-signature"] || headers["notion-signature"]);
  if (!provided) return false;

  const ts = headers["x-notion-request-timestamp"] || headers["notion-request-timestamp"] || "";
  const signedPayload = ts ? `${ts}.${rawBody}` : rawBody;
  const expected = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(signedPayload, "utf8")
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

function getPageIdFromEvent(body) {
  return (
    body?.entity?.id ||
    body?.data?.id ||
    body?.page?.id ||
    body?.page_id ||
    body?.event?.entity?.id ||
    null
  );
}

function getEventId(body) {
  return body?.id || body?.event_id || body?.event?.id || null;
}

function isPageUpdateEvent(body) {
  const type = String(body?.type || body?.event?.type || "").toLowerCase();
  return (
    type.includes("page") &&
    (type.includes("update") || type.includes("updated") || type.includes("content"))
  );
}

function send(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function handleWebhook(rawBody, headers, res) {
  const body = parseJson(rawBody);
  if (!body) return send(res, 400, { ok: false, error: "Invalid JSON" });

  if (!verifySignature(rawBody, headers)) {
    return send(res, 401, { ok: false, error: "Invalid webhook signature" });
  }

  if (body.verification_token) {
    console.log("NOTION_VERIFICATION_TOKEN:", body.verification_token);
    if (WEBHOOK_VERIFICATION_TOKEN && body.verification_token !== WEBHOOK_VERIFICATION_TOKEN) {
      return send(res, 403, { ok: false, error: "Verification token mismatch" });
    }
    return send(res, 200, { ok: true, verified: true });
  }

  const eventId = getEventId(body);
  if (eventId) {
    if (seenEventIds.has(eventId)) return send(res, 200, { ok: true, deduplicated: true });
    seenEventIds.add(eventId);
    if (seenEventIds.size > 500) {
      const first = seenEventIds.values().next().value;
      seenEventIds.delete(first);
    }
  }

  if (!isPageUpdateEvent(body)) {
    return send(res, 200, { ok: true, skipped: "non-page-update-event" });
  }

  const pageId = getPageIdFromEvent(body);
  if (!pageId) return send(res, 200, { ok: true, skipped: "page-id-not-found" });

  try {
    const result = await syncByPageId(cfg, pageId);
    return send(res, 200, { ok: true, synced: true, pageId, snippet: result });
  } catch (err) {
    return send(res, 500, { ok: false, error: String(err?.message || err) });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return send(res, 200, { ok: true });
  }

  if (req.method !== "POST" || req.url !== WEBHOOK_PATH) {
    return send(res, 404, { ok: false, error: "Not found" });
  }

  let rawBody = "";
  req.setEncoding("utf8");
  req.on("data", (chunk) => {
    rawBody += chunk;
    if (rawBody.length > 1_000_000) {
      req.destroy();
    }
  });
  req.on("end", () => {
    handleWebhook(rawBody, req.headers, res).catch((err) => {
      send(res, 500, { ok: false, error: String(err?.message || err) });
    });
  });
});

server.listen(PORT, () => {
  console.log(`Webhook server listening on :${PORT}${WEBHOOK_PATH}`);
});
