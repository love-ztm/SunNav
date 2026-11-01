interface Env {
  DB?: D1Database;
}

import {
  verify,
  getClientIP,
  RateLimiter,
  ERROR_MESSAGES,
  getJwtSecret,
} from "./utils/authHelpers";
import { ensureSchema } from "./utils/schema";
import { readAllCategories, getBootstrapConfig } from "./utils/reads";
import { diffCategories, applyCategoryDiff } from "./utils/diff";
import { validateFullCategory, validatePreferences } from "./utils/validation";
import { isBlockedHost, expandDecimalHost } from "./utils/ssrf";

const CONFIG_KEY = "webdav_config";
const LAST_KEY = "webdav_last_backup";
const PREFIX = "sunnav-backup-";
const NAME_RE = /^sunnav-backup-[\w-]+\.json$/;

const webdavRateLimiter = new RateLimiter("webdav", 30, 60 * 1000);

interface WebDavConfig {
  url: string;
  username: string;
  /** base64-obfuscated (it sits in the owner's own D1, this only hides it from casual DB reads) */
  password: string;
  path: string;
  /** HH:mm in the user's local timezone */
  scheduleTime: string;
  retention: number;
  enabled: boolean;
}

// --- password obfuscation helpers ---
function encodePw(pw: string): string {
  const bytes = new TextEncoder().encode(pw);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function decodePw(v: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(v), (c) => c.charCodeAt(0)));
}

async function loadConfig(db: D1Database): Promise<WebDavConfig | null> {
  const row = await db
    .prepare("SELECT value FROM config WHERE key = ?1")
    .bind(CONFIG_KEY)
    .first<{ value: string }>();
  if (!row?.value) return null;
  try {
    const raw = JSON.parse(row.value) as Partial<WebDavConfig>;
    if (!raw.url || !raw.username || !raw.password) return null;
    return {
      url: raw.url,
      username: raw.username,
      password: raw.password,
      path: raw.path || "sunnav-backups",
      scheduleTime: raw.scheduleTime || "03:00",
      retention: Math.min(50, Math.max(1, raw.retention || 7)),
      enabled: raw.enabled === true,
    };
  } catch {
    return null;
  }
}

function sanitizeConfig(raw: Partial<WebDavConfig>, prev: WebDavConfig | null): WebDavConfig {
  const url = String(raw.url || prev?.url || "").trim();
  if (!/^https?:\/\//i.test(url)) throw new Error("WebDAV URL must start with http(s)://");
  const hostname = new URL(url).hostname;
  const expanded = /^\d{1,3}(\.\d{1,3}){1,3}$/.test(hostname)
    ? expandDecimalHost(hostname)
    : null;
  if (isBlockedHost(hostname) || (expanded && isBlockedHost(expanded.join(".")))) {
    throw new Error("WebDAV host is not allowed");
  }
  const password =
    typeof raw.password === "string" && raw.password.length > 0
      ? encodePw(raw.password)
      : prev?.password || "";
  if (!password) throw new Error("WebDAV password is required");
  return {
    url,
    username: String(raw.username || prev?.username || "").trim(),
    password,
    path: String(raw.path || prev?.path || "sunnav-backups")
      .replace(/^\/+|\/+$/g, "")
      .trim(),
    scheduleTime: /^\d{2}:\d{2}$/.test(String(raw.scheduleTime || ""))
      ? String(raw.scheduleTime)
      : prev?.scheduleTime || "03:00",
    retention: Math.min(50, Math.max(1, Number(raw.retention) || prev?.retention || 7)),
    enabled: raw.enabled === true,
  };
}

function davBase(cfg: WebDavConfig): string {
  const base = cfg.url.endsWith("/") ? cfg.url : `${cfg.url}/`;
  const path = cfg.path ? `${cfg.path.replace(/^\/+|\/+$/g, "")}/` : "";
  return `${base}${path}`;
}

async function davFetch(
  cfg: WebDavConfig,
  file: string | null,
  init: RequestInit
): Promise<Response> {
  const target = davBase(cfg) + (file ?? "");
  const auth = "Basic " + btoa(`${cfg.username}:${decodePw(cfg.password)}`);
  return fetch(target, {
    ...init,
    headers: { Authorization: auth, ...(init.headers || {}) },
  });
}

async function ensureDir(cfg: WebDavConfig): Promise<void> {
  try {
    await davFetch(cfg, null, { method: "MKCOL" });
  } catch {
    // 405 (exists) / 301 (redirect) are fine; the PUT below surfaces real errors.
  }
}

interface BackupEntry {
  name: string;
  size: number;
  lastModified: string;
}

async function listBackups(cfg: WebDavConfig): Promise<BackupEntry[]> {
  const res = await davFetch(cfg, null, { method: "PROPFIND", headers: { Depth: "1" } });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`WebDAV list failed (${res.status})`);
  const xml = await res.text();
  const entries: BackupEntry[] = [];
  const re = /<(?:[\w.]+:)?response\b[\s\S]*?<\/(?:[\w.]+:)?response>/g;
  for (const entry of xml.match(re) || []) {
    const href = entry.match(/<(?:[\w.]+:)?href>\s*([^<]+?)\s*<\/(?:[\w.]+:)?href>/)?.[1] || "";
    const name = decodeURIComponent(href.split("/").filter(Boolean).pop() || "");
    if (!name.startsWith(PREFIX) || !name.endsWith(".json")) continue;
    const size = Number(entry.match(/<(?:[\w.]+:)?getcontentlength>\s*(\d+)/)?.[1] || 0);
    const lastModified = entry.match(
      /<(?:[\w.]+:)?getlastmodified>\s*([^<]+?)\s*<\/(?:[\w.]+:)?getlastmodified>/
    )?.[1] || "";
    entries.push({ name, size, lastModified });
  }
  return entries.sort((a, b) => b.name.localeCompare(a.name));
}

async function upsertConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

async function bumpDataVersion(db: D1Database): Promise<void> {
  await db
    .prepare(
      "INSERT INTO config (key, value) VALUES ('data_version', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(config.value AS INTEGER) + 1 AS TEXT)"
    )
    .run();
}

/** Serialises the current site data into the backup envelope. */
async function buildBackupBody(db: D1Database): Promise<string> {
  const [categories, cfg] = await Promise.all([readAllCategories(db), getBootstrapConfig(db)]);
  return JSON.stringify({
    version: 1,
    timestamp: Date.now(),
    categories,
    background: cfg.background,
    prefs: cfg.prefs,
  });
}

async function runBackup(db: D1Database, cfg: WebDavConfig): Promise<{ name: string }> {
  const body = await buildBackupBody(db);
  await ensureDir(cfg);
  const name = `${PREFIX}${Date.now()}.json`;
  const put = await davFetch(cfg, name, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!put.ok) throw new Error(`WebDAV upload failed (${put.status})`);

  // Prune beyond retention (epoch in the name keeps sort order chronological).
  try {
    const items = await listBackups(cfg);
    const excess = items.slice(Math.max(1, cfg.retention));
    for (const item of excess) {
      await davFetch(cfg, item.name, { method: "DELETE" });
    }
  } catch {
    // Pruning is best-effort; the backup itself already succeeded.
  }

  await upsertConfig(db, LAST_KEY, JSON.stringify({ at: Date.now() }));
  return { name };
}

async function restoreBackup(
  db: D1Database,
  cfg: WebDavConfig,
  name: string
): Promise<{ restored: number }> {
  if (!NAME_RE.test(name)) throw new Error("Invalid backup file name");
  const res = await davFetch(cfg, name, { method: "GET" });
  if (!res.ok) throw new Error(`WebDAV download failed (${res.status})`);
  const text = await res.text();
  if (text.length > 5 * 1024 * 1024) throw new Error("Backup file too large");
  let data: {
    categories?: unknown;
    background?: unknown;
    prefs?: unknown;
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Backup file is not valid JSON");
  }
  if (!Array.isArray(data.categories)) throw new Error("Backup has no categories");
  if (data.categories.length > 50) throw new Error("Too many categories (max 50)");
  for (const cat of data.categories) {
    const v = validateFullCategory(cat);
    if (!v.valid) throw new Error(v.message || "Invalid backup data");
  }
  if (data.background !== undefined && data.background !== null) {
    if (typeof data.background !== "string" || data.background.length > 1000) {
      throw new Error("Backup background is invalid");
    }
  }
  if (data.prefs !== undefined && data.prefs !== null) {
    const v = validatePreferences(data.prefs);
    if (!v.valid) throw new Error(v.message || "Backup preferences are invalid");
    if (JSON.stringify(data.prefs).length > 10_000) {
      throw new Error("Backup preferences too large");
    }
  }

  const current = await readAllCategories(db);
  const diff = diffCategories(current, data.categories as never);
  await applyCategoryDiff(db, diff);
  if (typeof data.background === "string") {
    await upsertConfig(db, "background", data.background);
  }
  if (data.prefs !== undefined && data.prefs !== null) {
    await upsertConfig(db, "prefs", JSON.stringify(data.prefs));
  }
  await bumpDataVersion(db);
  return { restored: data.categories.length };
}

/** Lazy cron: run the backup when the caller's local clock has passed the
 *  configured time and today's backup hasn't been taken yet. */
async function maybeScheduledBackup(
  db: D1Database,
  cfg: WebDavConfig,
  localDate: string,
  localTime: string
): Promise<{ ran: boolean; reason?: string; name?: string }> {
  if (!cfg.enabled) return { ran: false, reason: "disabled" };
  if (!/^\d{2}:\d{2}$/.test(localTime) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
    return { ran: false, reason: "bad clock" };
  }
  if (localTime < cfg.scheduleTime) return { ran: false, reason: "too early" };
  const lastRow = await db
    .prepare("SELECT value FROM config WHERE key = ?1")
    .bind(LAST_KEY)
    .first<{ value: string }>();
  const last = (() => {
    try {
      return JSON.parse(lastRow?.value || "{}") as { date?: string };
    } catch {
      return {};
    }
  })();
  if (last.date === localDate) return { ran: false, reason: "already done today" };
  const { name } = await runBackup(db, cfg);
  await upsertConfig(db, LAST_KEY, JSON.stringify({ at: Date.now(), date: localDate }));
  return { ran: true, name };
}

function jsonOk(data: object) {
  return new Response(JSON.stringify({ success: true, ...data }), {
    headers: { "Content-Type": "application/json" },
  });
}
function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    const clientIP = getClientIP(request);
    if (env.DB) await ensureSchema(env.DB);

    if (!(await webdavRateLimiter.isAllowed(env.DB, clientIP))) {
      return jsonError(ERROR_MESSAGES.RATE_LIMITED, 429);
    }
    if (!env.DB) return jsonError("Database not available", 503);

    const token = request.headers.get("Authorization")?.split(" ")[1];
    if (!token) return jsonError(ERROR_MESSAGES.UNAUTHORIZED, 401);
    const jwtSecret = await getJwtSecret(env.DB);
    if (!(await verify(token, jwtSecret, "access"))) {
      return jsonError(ERROR_MESSAGES.UNAUTHORIZED, 403);
    }

    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action;
    const cfg = await loadConfig(env.DB);

    if (action === "get") {
      const lastRow = await env.DB
        .prepare("SELECT value FROM config WHERE key = ?1")
        .bind(LAST_KEY)
        .first<{ value: string }>();
      let lastBackup: { at?: number; date?: string } = {};
      try {
        lastBackup = JSON.parse(lastRow?.value || "{}");
      } catch {
        lastBackup = {};
      }
      return jsonOk({
        config: cfg
          ? { ...cfg, password: "" }
          : {
              url: "",
              username: "",
              password: "",
              path: "sunnav-backups",
              scheduleTime: "03:00",
              retention: 7,
              enabled: false,
            },
        lastBackup,
      });
    }

    if (action === "config") {
      const prev = cfg;
      const next = sanitizeConfig(body.config as Partial<WebDavConfig>, prev);
      await upsertConfig(env.DB, CONFIG_KEY, JSON.stringify(next));
      return jsonOk({});
    }

    if (!cfg) return jsonError("WebDAV is not configured yet", 409);

    if (action === "list") {
      return jsonOk({ items: await listBackups(cfg) });
    }

    if (action === "backup") {
      return jsonOk(await runBackup(env.DB, cfg));
    }

    if (action === "restore") {
      const name = String(body.name || "");
      return jsonOk(await restoreBackup(env.DB, cfg, name));
    }

    if (action === "delete") {
      const name = String(body.name || "");
      if (!NAME_RE.test(name)) return jsonError("Invalid backup file name");
      const res = await davFetch(cfg, name, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        return jsonError(`WebDAV delete failed (${res.status})`);
      }
      return jsonOk({});
    }

    if (action === "tick") {
      const localDate = String(body.localDate || "");
      const localTime = String(body.localTime || "");
      try {
        return jsonOk(
          await maybeScheduledBackup(env.DB, cfg, localDate, localTime)
        );
      } catch (err) {
        console.error("WebDAV scheduled backup failed:", err);
        return jsonOk({ ran: false, reason: "backup failed" });
      }
    }

    return jsonError(ERROR_MESSAGES.INVALID_DATA);
  } catch (error) {
    console.error("WebDAV API Error:", error);
    return jsonError(error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR, 500);
  }
};
