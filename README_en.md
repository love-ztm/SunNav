# SunNav

A personal navigation dashboard with a pink glassmorphism aesthetic. Based on the open-source project [ModernNav](https://github.com/lyan0220/ModernNav) by the original author [Lyan](https://github.com/lyan0220), built with React + Tailwind CSS on the frontend and Cloudflare Pages Functions + D1 on the backend — entirely on the Cloudflare free tier.

Live demo: **https://nav.ww.fyi**

[中文](README.md) | English

## Features

**Frontend**

- Three-level structure (categories → subgroups → links) with glassmorphism cards
- Unified search (site / Google / Bing / configurable engines, `/` opens the command palette)
- Light / dark / system themes, with a dedicated wallpaper for dark mode
- Daily wallpaper, auto-extracted theme color, background blur, tunable glass settings
- Card width / height / icon size / **cards per row** — all adjustable in the admin panel
- Private categories visible only when signed in with the access code
- Bilingual (English / Chinese), Chinese by default
- PWA: installable to the home screen

**Admin (`/admin`, default access code `admin`)**

- Content: full CRUD for categories & links, drag-and-drop ordering, ⭐ mark any category as the default one shown on open
- Appearance: wallpaper, theme color, glass quality, full layout parameters
- **WebDAV cloud backup**: configure up to two WebDAV targets (Jianguoyun / InfiniCLOUD / AList…)
  - Scheduled daily backups with a retention count — old files pruned automatically
  - Browse the backup list and restore any snapshot in one click
- JSON import/export, browser bookmark import
- Access code change (PBKDF2-hashed; rotating it signs out all devices)

## Deploy (Cloudflare Pages)

1. Fork or push this repo → Cloudflare Dashboard → **Workers & Pages** → connect the repo and create a Pages project (framework: Vite, build command `npm run build`)
2. Create a **D1 database** (e.g. `sunnav-db`) and run [`schema-console.sql`](./schema-console.sql) in its **Console** — the D1 dashboard fails to parse `--` comments, so use this comment-free copy; the annotated [`schema.sql`](./schema.sql) is for the wrangler CLI
3. In the Pages project → **Settings → Bindings**, add a D1 binding: variable name **`DB`** → select the database → **redeploy**
4. Open the site and enter the admin panel via the gear icon. Default username / password: **admin / admin** (the sign-in page only asks for the access code `admin`). Change it right away under General → bottom of the page

> Changing the access code rotates the JWT signing secret; all signed-in devices must log in again.

## WebDAV scheduled backups

Cloudflare Pages Functions have no persistent cron, so scheduling is **lazy-triggered**: while the page is open it quietly checks every 10 minutes and runs a backup once the configured time has passed for the day. The actual backup moment is therefore "the first visit after the scheduled time"; keep the page open for on-the-dot runs.

- Prefer an **app password** (Jianguoyun: Account info → Security → generate app password)
- The WebDAV URL must be publicly reachable (LAN NAS addresses are not reachable from Cloudflare)
- Backup files are JSON (categories + wallpaper + prefs) in the same format as the manual export

## Development

```bash
npm install
npx wrangler d1 execute sunnav-db --local --file=./schema.sql
npm run dev
npm run build
npx wrangler pages dev ./dist
```

## Credits & License

Built on top of [ModernNav](https://github.com/lyan0220/ModernNav) by the original author [Lyan](https://github.com/lyan0220) — many thanks.

[MIT](./LICENSE)
