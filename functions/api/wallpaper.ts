import { isBlockedHost } from "./utils/ssrf";
import { ensureSchema } from "./utils/schema";
import { RateLimiter, getClientIP, ERROR_MESSAGES } from "./utils/authHelpers";

interface Env {
  DB?: D1Database;
}

// Bing's daily-image API has no CORS headers, so the browser cannot call it
// directly — this endpoint proxies it (host-validated, timeout-bounded) and
// caches the day's result in D1 so repeated visits skip the upstream call.
const BING_API = "https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1";
const CACHE_KEY = "wallpaper_cache";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const wallpaperRateLimiter = new RateLimiter("wallpaper", 30, 60 * 1000);

interface WallpaperPayload {
  fetchedAt: number;
  date: string;
  url: string;
  copyright?: string;
}

function json(body: WallpaperPayload | { error: string }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function fetchFromBing(): Promise<WallpaperPayload | null> {
  const apiUrl = new URL(BING_API);
  if (isBlockedHost(apiUrl.hostname)) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(apiUrl.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "SunNav/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      images?: { url?: string; copyright?: string; startdate?: string }[];
    };
    const image = data.images?.[0];
    if (!image?.url) return null;

    const url = image.url.startsWith("http") ? image.url : `https://www.bing.com${image.url}`;
    if (isBlockedHost(new URL(url).hostname)) return null;

    return {
      fetchedAt: Date.now(),
      date: image.startdate ?? new Date().toISOString().slice(0, 10),
      url,
      copyright: image.copyright,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  try {
    if (env.DB) {
      await ensureSchema(env.DB);
      if (!(await wallpaperRateLimiter.isAllowed(env.DB, getClientIP(request)))) {
        return json({ error: ERROR_MESSAGES.RATE_LIMITED }, 429);
      }

      const row = await env.DB.prepare("SELECT value FROM config WHERE key = ?")
        .bind(CACHE_KEY)
        .first<{ value: string }>();
      if (row?.value) {
        try {
          const cached = JSON.parse(row.value) as WallpaperPayload;
          if (Date.now() - cached.fetchedAt < CACHE_TTL_MS && cached.url) {
            return json(cached);
          }
        } catch {
          // malformed cache entry — refetch below
        }
      }
    }

    const payload = await fetchFromBing();
    if (!payload) return json({ error: ERROR_MESSAGES.SERVER_ERROR }, 502);

    if (env.DB) {
      await env.DB.prepare(
        "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      )
        .bind(CACHE_KEY, JSON.stringify(payload))
        .run();
    }
    return json(payload);
  } catch {
    return json({ error: ERROR_MESSAGES.SERVER_ERROR }, 500);
  }
};
