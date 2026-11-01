import React, { useCallback, useEffect, useState } from "react";
import { apiClient } from "../../services/apiClient";
import { useLanguage } from "../../contexts/LanguageContext";
import { useViewportScale } from "../../hooks/useViewportScale";
import { getIconSize } from "../../utils/favicon";
import { SettingsSection, SettingsRow } from "./SettingsPrimitives";
import { CloudUpload, Download, Loader2, Save, Trash2, Upload } from "../../utils/icons";

interface WebDavConfig {
  url: string;
  username: string;
  password: string;
  path: string;
  scheduleTime: string;
  retention: number;
  enabled: boolean;
}

interface BackupEntry {
  name: string;
  size: number;
  lastModified: string;
}

const NAME_PREFIX = "sunnav-backup-";
const EMPTY_CFG: WebDavConfig = {
  url: "",
  username: "",
  password: "",
  path: "sunnav-backups",
  scheduleTime: "03:00",
  retention: 7,
  enabled: false,
};

async function webdavAction<T>(body: Record<string, unknown>): Promise<T> {
  return apiClient.request<T>("/api/webdav", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function formatEntryTime(name: string): string {
  const epoch = Number(name.replace(NAME_PREFIX, "").replace(".json", ""));
  if (!Number.isFinite(epoch)) return name;
  return new Date(epoch).toLocaleString();
}

export const WebDavBackup: React.FC = () => {
  const { t } = useLanguage();
  const viewportScale = useViewportScale();
  const s = (n: number) => getIconSize(n, viewportScale);

  const [cfg, setCfg] = useState<WebDavConfig>(EMPTY_CFG);
  const [lastBackupAt, setLastBackupAt] = useState<number | undefined>(undefined);
  const [items, setItems] = useState<BackupEntry[] | null>(null);
  const [busy, setBusy] = useState<"none" | "save" | "backup" | "list" | "restore" | "delete">(
    "none"
  );
  const [status, setStatus] = useState<{ type: "success" | "error" | null; message: string }>({
    type: null,
    message: "",
  });

  const flash = useCallback((type: "success" | "error", message: string) => {
    setStatus({ type, message });
    setTimeout(() => setStatus({ type: null, message: "" }), 5000);
  }, []);

  const refreshList = useCallback(async () => {
    try {
      const res = await webdavAction<{ items: BackupEntry[] }>({ action: "list" });
      setItems(res.items);
    } catch {
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await webdavAction<{
          config: WebDavConfig;
          lastBackup: { at?: number };
        }>({ action: "get" });
        setCfg({ ...EMPTY_CFG, ...res.config, password: "" });
        setLastBackupAt(res.lastBackup?.at);
        void refreshList();
      } catch {
        // Server has no config yet or DB unavailable — form stays empty.
        setItems([]);
      }
    })();
  }, [refreshList]);

  const run = useCallback(
    async (kind: typeof busy, fn: () => Promise<void>) => {
      setBusy(kind);
      try {
        await fn();
      } catch (err) {
        flash(
          "error",
          err instanceof Error ? err.message : t("webdav_failed")
        );
      } finally {
        setBusy("none");
      }
    },
    [flash, t]
  );

  const handleSaveCfg = () =>
    run("save", async () => {
      await webdavAction({ action: "config", config: { ...cfg } });
      flash("success", t("webdav_saved"));
      void refreshList();
    });

  const handleBackupNow = () =>
    run("backup", async () => {
      const res = await webdavAction<{ name: string }>({ action: "backup" });
      flash("success", t("webdav_backup_done", { name: res.name }));
      void refreshList();
    });

  const handleRestore = (name: string) => {
    if (!window.confirm(t("webdav_restore_confirm"))) return;
    void run("restore", async () => {
      const res = await webdavAction<{ restored: number }>({
        action: "restore",
        name,
      });
      flash("success", t("webdav_restored", { count: String(res.restored) }));
    });
  };

  const handleDelete = (name: string) => {
    if (!window.confirm(t("webdav_delete_confirm"))) return;
    void run("delete", async () => {
      await webdavAction({ action: "delete", name });
      flash("success", t("webdav_deleted"));
      void refreshList();
    });
  };

  const field =
    "input-primary py-2 px-3 text-[11px] w-full";

  return (
    <SettingsSection
      icon={CloudUpload}
      title={t("webdav_title")}
      description={t("webdav_desc")}
    >
      <div className="space-y-3">
        <label className="flex items-center gap-2 text-[11px] font-bold text-secondary cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })}
            className="w-4 h-4 accent-[var(--theme-primary)]"
          />
          {t("webdav_enabled")}
        </label>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SettingsRow label={t("webdav_url")}>
            <input
              type="text"
              value={cfg.url}
              onChange={(e) => setCfg({ ...cfg, url: e.target.value })}
              placeholder="https://dav.jianguoyun.com/dav/"
              className={field}
            />
          </SettingsRow>
          <SettingsRow label={t("webdav_username")}>
            <input
              type="text"
              value={cfg.username}
              onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
              autoComplete="off"
              className={field}
            />
          </SettingsRow>
          <SettingsRow label={t("webdav_password")} hint={t("webdav_password_hint")}>
            <input
              type="password"
              value={cfg.password}
              onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
              autoComplete="new-password"
              className={field}
            />
          </SettingsRow>
          <SettingsRow label={t("webdav_path")}>
            <input
              type="text"
              value={cfg.path}
              onChange={(e) => setCfg({ ...cfg, path: e.target.value })}
              className={field}
            />
          </SettingsRow>
          <SettingsRow label={t("webdav_schedule")}>
            <input
              type="time"
              value={cfg.scheduleTime}
              onChange={(e) => setCfg({ ...cfg, scheduleTime: e.target.value })}
              className={field}
            />
          </SettingsRow>
          <SettingsRow label={t("webdav_retention")}>
            <input
              type="number"
              min={1}
              max={50}
              value={cfg.retention}
              onChange={(e) => setCfg({ ...cfg, retention: Number(e.target.value) })}
              className={field}
            />
          </SettingsRow>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveCfg}
            disabled={busy !== "none"}
            className="btn-secondary py-2 px-4 rounded-xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center gap-2"
          >
            {busy === "save" ? <Loader2 size={s(14)} className="animate-spin" /> : <Save size={s(14)} />}
            {t("webdav_save_cfg")}
          </button>
          <button
            type="button"
            onClick={handleBackupNow}
            disabled={busy !== "none"}
            className="btn-primary py-2 px-4 rounded-xl text-[10px] font-bold uppercase tracking-widest disabled:opacity-50 flex items-center gap-2"
          >
            {busy === "backup" ? (
              <Loader2 size={s(14)} className="animate-spin" />
            ) : (
              <Upload size={s(14)} />
            )}
            {t("webdav_backup_now")}
          </button>
          {lastBackupAt ? (
            <span className="text-[10px] text-muted">
              {t("webdav_last_backup", { time: new Date(lastBackupAt).toLocaleString() })}
            </span>
          ) : null}
        </div>

        <div>
          <div className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-1.5">
            {t("webdav_list_title")}
          </div>
          {items === null ? (
            <div className="text-[11px] text-muted py-2 flex items-center gap-2">
              <Loader2 size={s(14)} className="animate-spin" /> …
            </div>
          ) : items.length === 0 ? (
            <div className="text-[11px] text-muted py-2">{t("webdav_list_empty")}</div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center gap-2 p-2 rounded-lg border border-default text-[11px]"
                >
                  <span className="font-mono flex-1 truncate" title={item.name}>
                    {formatEntryTime(item.name)}
                  </span>
                  <span className="text-muted shrink-0">
                    {(item.size / 1024).toFixed(1)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRestore(item.name)}
                    disabled={busy !== "none"}
                    className="btn-secondary py-1 px-2.5 rounded-lg disabled:opacity-50 flex items-center gap-1 shrink-0"
                  >
                    {busy === "restore" ? (
                      <Loader2 size={s(12)} className="animate-spin" />
                    ) : (
                      <Download size={s(12)} />
                    )}
                    {t("webdav_restore")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(item.name)}
                    disabled={busy !== "none"}
                    className="p-1.5 rounded-lg text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0"
                    title={t("webdav_delete")}
                  >
                    <Trash2 size={s(12)} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {status.type && (
          <div
            className={`p-3 rounded-xl text-xs font-bold border ${
              status.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                : "bg-red-500/10 border-red-500/20 text-red-500"
            }`}
          >
            {status.message}
          </div>
        )}
      </div>
    </SettingsSection>
  );
};
