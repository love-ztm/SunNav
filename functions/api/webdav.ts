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
const MAX_TARGETS = 2;

const webdavRateLimiter = new RateLimiter("webdav", 40, 60 * 1000);

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

interface LastBackup {
  at?: number;
  date?: string;
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

function sanitizeTarget(raw: Partial<WebDavConfig>, prev: WebDavConfig | null): WebDavConfig {
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

/** Accepts the current {targets:[...]} shape and the legacy single-target shape. */
async function loadTargets(db: D1Database): Promise<WebDavConfig[]> {
  const row = await db
    .prepare("SELECT value FROM config WHERE key = ?1")
    .bind(CONFIG_KEY)
    .first<{ value: string }>();
  if (!row?.value) return [];
  try {
    const parsed = JSON.parse(row.value) as
      | { targets?: Partial<WebDavConfig>[] }
      | Partial<WebDavConfig>;
    let raws: Partial<WebDavConfig>[];
    if ("targets" in parsed && Array.isArray(parsed.targets)) {
      raws = parsed.targets as Partial<WebDavConfig>[];
    } else {
      const single = parsed as Partial<WebDavConfig>;
      raws = single.url ? [single] : [];
    }
    // Targets were sanitized when saved — load them verbatim (the stored
    // password is already obfuscated; re-running encodePw would break it).
    return raws.slice(0, MAX_TARGETS).map((r) => ({
      url: String(r.url || ""),
      username: String(r.username || ""),
      password: String(r.password || ""),
      path: String(r.path || "sunnav-backups"),
      scheduleTime: /^\d{2}:\d{2}$/.test(String(r.scheduleTime || "")) ? String(r.scheduleTime) : "03:00",
      retention: Math.min(50, Math.max(1, Number(r.retention) || 7)),
      enabled: r.enabled === true,
    })) as WebDavConfig[];
  } catch {
    return [];
  }
}

async function saveTargets(db: D1Database, targets: WebDavConfig[]): Promise<void> {
  await upsertConfig(db, CONFIG_KEY, JSON.stringify({ targets: targets.slice(0, MAX_TARGETS) }));
}

async function loadLastBackups(db: D1Database): Promise<LastBackup[]> {
  const row = await db
    .prepare("SELECT value FROM config WHERE key = ?1")
    .bind(LAST_KEY)
    .first<{ value: string }>();
  try {
    const parsed = JSON.parse(row?.value || "[]");
    if (Array.isArray(parsed)) return parsed as LastBackup[];
    if (parsed && typeof parsed === "object" && ("at" in parsed || "date" in parsed)) {
      return [parsed as LastBackup]; // legacy single object
    }
    return [];
  } catch {
    return [];
  }
}

function pickTarget(targets: WebDavConfig[], index: number): WebDavConfig {
  const cfg = targets[Number(index)];
  if (!cfg) throw new Error("This WebDAV target is not configured");
  return cfg;
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

/** Lazy cron: run each enabled target's backup when the caller's local clock
 *  has passed its configured time and today's backup hasn't been taken. */
async function maybeScheduledBackups(
  db: D1Database,
  targets: WebDavConfig[],
  localDate: string,
  localTime: string
): Promise<{ ran: boolean; results: { index: number; ran: boolean; reason?: string }[] }> {
  const lastBackups = await loadLastBackups(db);
  const results: { index: number; ran: boolean; reason?: string }[] = [];
  let anyRan = false;

  for (let i = 0; i < targets.length; i++) {
    const cfg = targets[i];
    if (!cfg.enabled) {
      results.push({ index: i, ran: false, reason: "disabled" });
      continue;
    }
    if (!/^\d{2}:\d{2}$/.test(localTime) || !/^\d{4}-\d{2}-\d{2}$/.test(localDate)) {
      results.push({ index: i, ran: false, reason: "bad clock" });
      continue;
    }
    if (localTime < cfg.scheduleTime) {
      results.push({ index: i, ran: false, reason: "too early" });
      continue;
    }
    if (lastBackups[i]?.date === localDate) {
      results.push({ index: i, ran: false, reason: "already done today" });
      continue;
    }
    try {
      await runBackup(db, cfg);
      lastBackups[i] = { at: Date.now(), date: localDate };
      results.push({ index: i, ran: true });
      anyRan = true;
    } catch (err) {
      console.error(`WebDAV scheduled backup failed (target ${i}):`, err);
      results.push({ index: i, ran: false, reason: "backup failed" });
    }
  }
  if (anyRan) {
    await upsertConfig(db, LAST_KEY, JSON.stringify(lastBackups));
  }
  return { ran: anyRan, results };
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
    const targetIndex = Number(body.target) === 1 ? 1 : 0;
    const targets = await loadTargets(env.DB);

    if (action === "get") {
      const lastBackups = await loadLastBackups(env.DB);
      const empty: WebDavConfig = {
        url: "",
        username: "",
        password: "",
        path: "sunnav-backups",
        scheduleTime: "03:00",
        retention: 7,
        enabled: false,
      };
      const masked = [0, 1].map(
        (i) => (targets[i] ? { ...targets[i], password: "" } : { ...empty })
      );
      return jsonOk({ targets: masked, lastBackups });
    }

    if (action === "config") {
      const raw = (body.config || {}) as { targets?: Partial<WebDavConfig>[] };
      const raws = Array.isArray(raw.targets) ? raw.targets.slice(0, MAX_TARGETS) : [];
      const current = await loadTargets(env.DB);
      const next: WebDavConfig[] = [];
      for (let i = 0; i < raws.length; i++) {
        const rawTarget = raws[i];
        // An untouched empty slot stays empty; blank password keeps the stored one.
        if (!rawTarget.url && !current[i]) continue;
        if (!rawTarget.url) {
          next.push(current[i]);
          continue;
        }
        next.push(sanitizeTarget(rawTarget, current[i] || null));
      }
      await saveTargets(env.DB, next);
      return jsonOk({});
    }

    if (targets.length === 0) return jsonError("WebDAV is not configured yet", 409);

    if (action === "list") {
      return jsonOk({ items: await listBackups(pickTarget(targets, targetIndex)) });
    }

    if (action === "backup") {
      return jsonOk(await runBackup(env.DB, pickTarget(targets, targetIndex)));
    }

    if (action === "restore") {
      const name = String(body.name || "");
      return jsonOk(await restoreBackup(env.DB, pickTarget(targets, targetIndex), name));
    }

    if (action === "delete") {
      const name = String(body.name || "");
      if (!NAME_RE.test(name)) return jsonError("Invalid backup file name");
      const res = await davFetch(pickTarget(targets, targetIndex), name, { method: "DELETE" });
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
          await maybeScheduledBackups(env.DB, targets, localDate, localTime)
        );
      } catch (err) {
        console.error("WebDAV scheduled backup failed:", err);
        return jsonOk({ ran: false, results: [] });
      }
    }

    return jsonError(ERROR_MESSAGES.INVALID_DATA);
  } catch (error) {
    console.error("WebDAV API Error:", error);
    return jsonError(error instanceof Error ? error.message : ERROR_MESSAGES.SERVER_ERROR, 500);
  }
};
