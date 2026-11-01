// The "daily" sentinel marks a background that resolves to today's Bing
// image. Stored in prefs as-is; rendered through useResolvedBackground.
export const DAILY_BACKGROUND = "daily";

export function isDailyBackground(background: string): boolean {
  return background === DAILY_BACKGROUND;
}

export interface DailyWallpaper {
  date: string;
  url: string;
  copyright?: string;
}

const LS_KEY = "sunNav_daily_wallpaper";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function readCache(): string | null {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) ?? "null") as DailyWallpaper | null;
    if (cached?.date === today() && cached.url) return cached.url;
  } catch {
    // malformed cache entry — refetch
  }
  return null;
}

function writeCache(payload: DailyWallpaper): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...payload, date: today() }));
  } catch {
    // storage full / unavailable — the URL still works for this session
  }
}

export function cachedDailyWallpaper(): string | null {
  return readCache();
}

export async function fetchDailyWallpaper(): Promise<string> {
  const cached = readCache();
  if (cached) return cached;

  const res = await fetch("/api/wallpaper");
  if (!res.ok) throw new Error(`wallpaper unavailable (HTTP ${res.status})`);
  const data = (await res.json()) as DailyWallpaper;
  if (!data.url) throw new Error("wallpaper unavailable");
  writeCache(data);
  return data.url;
}
