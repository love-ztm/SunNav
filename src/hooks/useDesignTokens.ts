import { useEffect } from "react";
import { useBootstrap } from "../services/queries";
import { getDominantColor, themeAccentVars } from "../utils/color";
import { fetchDailyWallpaper, isDailyBackground } from "../utils/background";
import { DEFAULT_BACKGROUND } from "../constants/defaults";
import { resolveThemeMode } from "../utils/theme";
import { usePrefersDark } from "./usePrefersDark";
import {
  DEFAULT_PREFS,
  DEFAULT_THEME_COLOR,
  DEFAULT_ANIMATION_LEVEL,
  DEFAULT_ANIMATION_SPEED,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_SATURATION,
  DEFAULT_GLASS_NOISE,
  DEFAULT_GLASS_TINT,
  DEFAULT_RADIUS_SCALE,
  DEFAULT_DENSITY_SCALE,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_SIZE,
} from "../constants/defaults";

const FONT_WEIGHT_MAP = { light: "300", regular: "400", medium: "500" } as const;

export function useDesignTokens() {
  const { data } = useBootstrap();
  const prefs = data?.prefs ?? DEFAULT_PREFS;
  const background = data?.background ?? "";

  const themeColorAuto = prefs.themeColorAuto ?? true;
  const savedColor = prefs.themeColor || DEFAULT_THEME_COLOR;

  const glassBlur = prefs.glassBlur ?? DEFAULT_GLASS_BLUR;
  const glassSaturation = prefs.glassSaturation ?? DEFAULT_GLASS_SATURATION;
  const glassNoise = prefs.glassNoise ?? DEFAULT_GLASS_NOISE;
  const glassTint = prefs.glassTint ?? prefs.cardOpacity ?? DEFAULT_GLASS_TINT;
  const radiusScale = prefs.radiusScale ?? DEFAULT_RADIUS_SCALE;
  const densityScale = prefs.densityScale ?? DEFAULT_DENSITY_SCALE;
  const fontWeight = prefs.fontWeight ?? DEFAULT_FONT_WEIGHT;
  const fontSize = prefs.fontSize ?? DEFAULT_FONT_SIZE;
  const animationLevel = prefs.animationLevel ?? DEFAULT_ANIMATION_LEVEL;
  const animationSpeed = prefs.animationSpeed ?? DEFAULT_ANIMATION_SPEED;

  useEffect(() => {
    let cancelled = false;
    const root = document.documentElement;

    const applyAccent = (color: string) => {
      if (cancelled) return;
      Object.entries(themeAccentVars(color)).forEach(([name, value]) => {
        root.style.setProperty(name, value);
      });
    };

    // Sentinels resolve to their concrete image URL before extraction.
    const resolveBackground = async (bg: string): Promise<string> => {
      if (isDailyBackground(bg)) {
        try {
          return await fetchDailyWallpaper();
        } catch {
          return DEFAULT_BACKGROUND;
        }
      }
      return bg;
    };

    const resolve = async () => {
      const resolvedBackground = await resolveBackground(background);
      if (
        themeColorAuto &&
        (resolvedBackground.startsWith("http") || resolvedBackground.startsWith("data:"))
      ) {
        const extracted = await getDominantColor(resolvedBackground);
        applyAccent(extracted);
        window.dispatchEvent(
          new CustomEvent("sunnav:accent-extracted", { detail: { color: extracted } })
        );
      } else {
        applyAccent(savedColor);
      }
    };

    resolve();
    return () => {
      cancelled = true;
    };
  }, [background, themeColorAuto, savedColor]);

  const prefersDark = usePrefersDark();
  const resolvedTheme = resolveThemeMode(prefs.themeMode, prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;

    root.style.setProperty("--glass-blur", `${glassBlur}px`);
    root.style.setProperty("--glass-saturation", `${glassSaturation}%`);
    root.style.setProperty("--glass-noise-opacity", `${glassNoise}`);
    root.style.setProperty("--glass-tint", `${glassTint}`);

    root.style.setProperty("--radius-scale", `${radiusScale}`);
    root.style.setProperty("--density-scale", `${densityScale}`);

    root.style.setProperty("--font-weight-body", FONT_WEIGHT_MAP[fontWeight]);
    root.style.setProperty("--font-size-scale", `${fontSize}`);

    root.style.setProperty("--animation-speed", `${animationSpeed}`);

    const levels = ["anim-none", "anim-subtle", "anim-fluid", "anim-expressive"];
    levels.forEach((cls) => root.classList.remove(cls));
    root.classList.add(`anim-${animationLevel}`);
  }, [
    glassBlur,
    glassSaturation,
    glassNoise,
    glassTint,
    radiusScale,
    densityScale,
    fontWeight,
    fontSize,
    animationLevel,
    animationSpeed,
  ]);
}
