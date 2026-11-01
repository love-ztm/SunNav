import React, { useState, useRef, useEffect, useReducer } from "react";
import {
  Sliders,
  RotateCcw,
  Save,
  Wand2,
  Loader2,
  Image as ImageIcon,
  Wallpaper,
  Sparkles,
  Moon,
  Layers,
  Type,
} from "../../utils/icons";
import { useLanguage } from "../../contexts/LanguageContext";
import { DEFAULT_BACKGROUND } from "../../services/storage";
import {
  DEFAULT_LAYOUT_UI,
  DEFAULT_PREFS,
  DEFAULT_THEME_COLOR,
  DEFAULT_GLASS_BLUR,
  DEFAULT_GLASS_SATURATION,
  DEFAULT_GLASS_NOISE,
  DEFAULT_GLASS_TINT,
  DEFAULT_RADIUS_SCALE,
  DEFAULT_DENSITY_SCALE,
  DEFAULT_FONT_WEIGHT,
  DEFAULT_FONT_SIZE,
  DEFAULT_ANIMATION_LEVEL,
  DEFAULT_ANIMATION_SPEED,
  DEFAULT_ANIMATION_STAGGER,
  DEFAULT_NAV_STYLE,
  DEFAULT_SEARCH_STYLE,
} from "../../constants/defaults";
import { getDominantColor, themeAccentVars } from "../../utils/color";
import { DAILY_BACKGROUND, isDailyBackground } from "../../utils/background";
import { useViewportScale } from "../../hooks/useViewportScale";
import { getIconSize } from "../../utils/favicon";
import { SettingsContainer, SettingsSection, SettingsRow } from "./SettingsPrimitives";
import {
  AnimationLevel,
  NavStyle,
  SearchStyle,
  FontWeightOption,
  UserPreferences,
} from "../../types";

const RangeSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, step, unit = "", onChange }) => {
  const id = React.useId();
  const percent = ((value - min) / (max - min)) * 100;

  return (
    <div className="group">
      <div className="flex justify-between mb-1.5 px-1">
        <label
          htmlFor={id}
          className="text-[10px] font-bold text-muted uppercase tracking-widest group-hover:text-secondary transition-colors"
        >
          {label}
        </label>
        <span className="text-[10px] text-[var(--theme-primary)] font-mono font-bold bg-[var(--theme-primary)]/10 px-1.5 py-0.5 rounded leading-none">
          {step < 1 ? value.toFixed(2) : value}
          {unit}
        </span>
      </div>
      {/* Native range input: keyboard arrows / Home / End come for free; the
          gradient paints the filled portion to match the glass theme. */}
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{
          background: `linear-gradient(to right, var(--theme-primary) 0%, var(--theme-primary) ${percent}%, var(--surface-hover) ${percent}%, var(--surface-hover) 100%) center / 100% var(--range-track-height) no-repeat`,
        }}
      />
    </div>
  );
};

// Module-level so the component type is stable across renders — defining it
// inside AppearanceTab would remount its buttons (losing focus) every render.
const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) => (
  <div role="group" className="flex gap-1 p-1 surface-active rounded-xl border border-muted">
    {options.map((opt) => (
      <button
        key={opt.value}
        onClick={() => onChange(opt.value)}
        aria-pressed={value === opt.value}
        className={`flex-1 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
          value === opt.value
            ? "bg-[var(--theme-primary)] text-white shadow-md"
            : "text-muted hover:text-secondary"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

interface AppearanceTabProps {
  prefs: UserPreferences;
  currentBackground: string;
  onUpdate: (background: string, prefs: Partial<UserPreferences>) => void;
}

// --- Draft form state -----------------------------------------------------
// The whole editor is one draft object snapshotted from the current prefs and
// only written to the server on Save. Field setters keep their historical
// names so the large JSX body below is untouched.
interface AppearanceDraft {
  background: string;
  backgroundDark: string;
  themeColor: string;
  themeColorAuto: boolean;
  cardOpacity: number;
  maxContainerWidth: number;
  cardWidth: number;
  cardHeight: number;
  iconScale: number;
  bgBlur: number;
  gridColumns: number;
  animationLevel: AnimationLevel;
  animationSpeed: number;
  animationStagger: number;
  glassBlur: number;
  glassSaturation: number;
  glassNoise: number;
  glassTint: number;
  radiusScale: number;
  densityScale: number;
  fontWeight: FontWeightOption;
  fontSize: number;
  navStyle: NavStyle;
  searchStyle: SearchStyle;
}

type DraftKey = keyof AppearanceDraft;

function draftFromPrefs(prefs: UserPreferences, background: string): AppearanceDraft {
  return {
    background,
    backgroundDark: prefs.backgroundDark || "",
    themeColor: prefs.themeColor || DEFAULT_THEME_COLOR,
    themeColorAuto: prefs.themeColorAuto ?? true,
    cardOpacity: prefs.cardOpacity,
    maxContainerWidth: prefs.maxContainerWidth ?? DEFAULT_LAYOUT_UI.width,
    cardWidth: prefs.cardWidth ?? DEFAULT_LAYOUT_UI.cardWidth,
    cardHeight: prefs.cardHeight ?? DEFAULT_LAYOUT_UI.cardHeight,
    iconScale: prefs.iconScale ?? 32,
    bgBlur: prefs.bgBlur ?? 0,
    gridColumns: prefs.gridColumns ?? DEFAULT_LAYOUT_UI.cols,
    animationLevel: prefs.animationLevel ?? DEFAULT_ANIMATION_LEVEL,
    animationSpeed: prefs.animationSpeed ?? DEFAULT_ANIMATION_SPEED,
    animationStagger: prefs.animationStagger ?? DEFAULT_ANIMATION_STAGGER,
    glassBlur: prefs.glassBlur ?? DEFAULT_GLASS_BLUR,
    glassSaturation: prefs.glassSaturation ?? DEFAULT_GLASS_SATURATION,
    glassNoise: prefs.glassNoise ?? DEFAULT_GLASS_NOISE,
    glassTint: prefs.glassTint ?? DEFAULT_GLASS_TINT,
    radiusScale: prefs.radiusScale ?? DEFAULT_RADIUS_SCALE,
    densityScale: prefs.densityScale ?? DEFAULT_DENSITY_SCALE,
    fontWeight: prefs.fontWeight ?? DEFAULT_FONT_WEIGHT,
    fontSize: prefs.fontSize ?? DEFAULT_FONT_SIZE,
    navStyle: prefs.navStyle ?? DEFAULT_NAV_STYLE,
    searchStyle: prefs.searchStyle ?? DEFAULT_SEARCH_STYLE,
  };
}

type AppearanceAction =
  | { type: "set"; key: DraftKey; value: string | number | boolean }
  | { type: "replace"; draft: AppearanceDraft }
  | { type: "reset" };

function appearanceReducer(state: AppearanceDraft, action: AppearanceAction): AppearanceDraft {
  switch (action.type) {
    case "set":
      return { ...state, [action.key]: action.value } as AppearanceDraft;
    case "replace":
      return action.draft;
    case "reset":
      return draftFromPrefs(DEFAULT_PREFS, DEFAULT_BACKGROUND);
  }
}

export const AppearanceTab: React.FC<AppearanceTabProps> = ({
  prefs,
  currentBackground,
  onUpdate,
}) => {
  const { t } = useLanguage();
  const viewportScale = useViewportScale();
  const s = (n: number) => getIconSize(n, viewportScale);

  const [draft, dispatch] = useReducer(appearanceReducer, undefined, () =>
    draftFromPrefs(prefs, currentBackground)
  );
  const {
    background: bgInput,
    backgroundDark: bgDarkInput,
    themeColor: themeColorInput,
    themeColorAuto: localAutoMode,
    cardOpacity: opacityInput,
    maxContainerWidth: widthInput,
    cardWidth: cardWidthInput,
    cardHeight: cardHeightInput,
    iconScale: iconScaleInput,
    bgBlur: bgBlurInput,
    gridColumns: colsInput,
    animationLevel,
    animationSpeed,
    animationStagger,
    glassBlur,
    glassSaturation,
    glassNoise,
    glassTint,
    radiusScale,
    densityScale,
    fontWeight,
    fontSize,
    navStyle,
    searchStyle,
  } = draft;

  const setBgInput = (v: string) => dispatch({ type: "set", key: "background", value: v });
  const setBgDarkInput = (v: string) =>
    dispatch({ type: "set", key: "backgroundDark", value: v });
  const setThemeColorInput = (v: string) => dispatch({ type: "set", key: "themeColor", value: v });
  const setLocalAutoMode = (v: boolean) =>
    dispatch({ type: "set", key: "themeColorAuto", value: v });
  const setOpacityInput = (v: number) => dispatch({ type: "set", key: "cardOpacity", value: v });
  const setWidthInput = (v: number) =>
    dispatch({ type: "set", key: "maxContainerWidth", value: v });
  const setCardWidthInput = (v: number) => dispatch({ type: "set", key: "cardWidth", value: v });
  const setCardHeightInput = (v: number) => dispatch({ type: "set", key: "cardHeight", value: v });
  const setIconScaleInput = (v: number) => dispatch({ type: "set", key: "iconScale", value: v });
  const setBgBlurInput = (v: number) => dispatch({ type: "set", key: "bgBlur", value: v });
  const setColsInput = (v: number) => dispatch({ type: "set", key: "gridColumns", value: v });
  const setAnimationLevel = (v: AnimationLevel) =>
    dispatch({ type: "set", key: "animationLevel", value: v });
  const setAnimationSpeed = (v: number) =>
    dispatch({ type: "set", key: "animationSpeed", value: v });
  const setAnimationStagger = (v: number) =>
    dispatch({ type: "set", key: "animationStagger", value: v });
  const setGlassBlur = (v: number) => dispatch({ type: "set", key: "glassBlur", value: v });
  const setGlassSaturation = (v: number) =>
    dispatch({ type: "set", key: "glassSaturation", value: v });
  const setGlassNoise = (v: number) => dispatch({ type: "set", key: "glassNoise", value: v });
  const setGlassTint = (v: number) => dispatch({ type: "set", key: "glassTint", value: v });
  const setRadiusScale = (v: number) => dispatch({ type: "set", key: "radiusScale", value: v });
  const setDensityScale = (v: number) => dispatch({ type: "set", key: "densityScale", value: v });
  const setFontWeight = (v: FontWeightOption) =>
    dispatch({ type: "set", key: "fontWeight", value: v });
  const setFontSize = (v: number) => dispatch({ type: "set", key: "fontSize", value: v });
  const setNavStyle = (v: NavStyle) => dispatch({ type: "set", key: "navStyle", value: v });
  const setSearchStyle = (v: SearchStyle) =>
    dispatch({ type: "set", key: "searchStyle", value: v });

  const [bgStatus, setBgStatus] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);

  // Re-sync the draft when prefs change externally (e.g. saved on another
  // device and refetched), but never clobber unsaved local edits: only
  // replace while the draft still matches the last synced snapshot. The
  // content check also keeps this effect from re-dispatching itself.
  const syncedRef = useRef(draft);
  // Mirror the extracted accent into the picker (extraction may complete
  // before this page mounts).
  useEffect(() => {
    if (!localAutoMode) return;
    const current = getComputedStyle(document.documentElement)
      .getPropertyValue("--theme-primary")
      .trim();
    if (current) setThemeColorInput(current);
  }, [localAutoMode]);
  useEffect(() => {
    const onExtracted = (e: Event) => {
      const color = (e as CustomEvent<{ color: string }>).detail?.color;
      if (color) setThemeColorInput(color);
    };
    window.addEventListener("modernnav:accent-extracted", onExtracted);
    return () => window.removeEventListener("modernnav:accent-extracted", onExtracted);
  }, []);
  useEffect(() => {
    const next = draftFromPrefs(prefs, currentBackground);
    const untouched = JSON.stringify(draft) === JSON.stringify(syncedRef.current);
    const changed = JSON.stringify(next) !== JSON.stringify(syncedRef.current);
    syncedRef.current = next;
    if (untouched && changed) dispatch({ type: "replace", draft: next });
  }, [prefs, currentBackground, draft]);

  const handleResetBackground = () => {
    dispatch({ type: "reset" });
    setBgStatus(t("bg_updated"));
    setTimeout(() => setBgStatus(""), 3000);
  };

  const handleSave = () => {
    onUpdate(bgInput, {
      ...prefs,
      backgroundDark: bgDarkInput,
      cardOpacity: opacityInput,
      themeColor: themeColorInput,
      themeColorAuto: localAutoMode,
      maxContainerWidth: widthInput,
      cardWidth: cardWidthInput,
      cardHeight: cardHeightInput,
      iconScale: iconScaleInput,
      gridColumns: colsInput,
      animationLevel,
      animationSpeed,
      animationStagger,
      glassBlur,
      glassSaturation,
      glassNoise,
      glassTint,
      radiusScale,
      densityScale,
      fontWeight,
      fontSize,
      navStyle,
      searchStyle,
    });
    setBgStatus(t("bg_updated"));
    setTimeout(() => setBgStatus(""), 3000);
  };

  const handleColorPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    setThemeColorInput(e.target.value);
    setLocalAutoMode(false);
  };

  const handleAutoExtract = async () => {
    if (!bgInput) return;
    setIsExtracting(true);
    setBgStatus(t("extracting_color"));
    try {
      const color = await getDominantColor(bgInput);
      setThemeColorInput(color);
      setLocalAutoMode(true);
      setBgStatus(t("theme_updated"));
    } catch {
      setBgStatus(t("extraction_failed"));
    } finally {
      setIsExtracting(false);
      setTimeout(() => setBgStatus(""), 3000);
    }
  };

  const previewStyles: Record<string, string | number> = {
    ...themeAccentVars(themeColorInput),
  };

  const animLevels: AnimationLevel[] = ["none", "subtle", "fluid", "expressive"];
  const navStyles: { value: NavStyle; label: string }[] = [
    { value: "floating", label: t("nav_floating") },
    { value: "flush", label: t("nav_flush") },
    { value: "minimal", label: t("nav_minimal") },
  ];
  const searchStyles: { value: SearchStyle; label: string }[] = [
    { value: "pill", label: t("search_pill") },
    { value: "underline", label: t("search_underline") },
    { value: "ghost", label: t("search_ghost") },
  ];
  const fontWeights: { value: FontWeightOption; label: string }[] = [
    { value: "light", label: t("font_light") },
    { value: "regular", label: t("font_regular") },
    { value: "medium", label: t("font_medium") },
  ];

  return (
    <>
      <SettingsContainer style={previewStyles}>
        {/* Single full-width column: every card aligns edge-to-edge. */}
        <div className="space-y-4">
        {/* Glass Quality */}
        <SettingsSection
          icon={Layers}
          title={t("glass_quality")}
          description={t("glass_quality_desc")}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <SettingsRow label={t("bg_url_label")}>
              <div className="relative">
                <ImageIcon
                  size={s(16)}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  value={bgInput}
                  onChange={(e) => setBgInput(e.target.value)}
                  placeholder={t("bg_url_placeholder")}
                  className="input-primary pl-10 pr-10 font-mono text-[11px]"
                />
                <button
                  onClick={() => setBgInput(DAILY_BACKGROUND)}
                  aria-pressed={isDailyBackground(bgInput)}
                  title={t("daily_wallpaper")}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors ${
                    isDailyBackground(bgInput)
                      ? "text-[var(--theme-primary)]"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  <Wallpaper size={s(16)} />
                </button>
              </div>
            </SettingsRow>

            <SettingsRow label={t("bg_url_label_dark")}>
              <div className="relative">
                <Moon
                  size={s(16)}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  type="text"
                  value={bgDarkInput}
                  onChange={(e) => setBgDarkInput(e.target.value)}
                  placeholder={t("bg_url_placeholder")}
                  className="input-primary pl-10 pr-10 font-mono text-[11px]"
                />
                <button
                  onClick={() => setBgDarkInput(DAILY_BACKGROUND)}
                  aria-pressed={isDailyBackground(bgDarkInput)}
                  title={t("daily_wallpaper")}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors ${
                    isDailyBackground(bgDarkInput)
                      ? "text-[var(--theme-primary)]"
                      : "text-muted hover:text-secondary"
                  }`}
                >
                  <Wallpaper size={s(16)} />
                </button>
              </div>
            </SettingsRow>

            <SettingsRow label={t("label_theme_color")}>
              <div className="flex items-center gap-2">
                <label
                  className="surface-hover rounded-lg p-1 border border-muted cursor-pointer hover:surface-active transition-colors"
                  title={themeColorInput}
                >
                  <input
                    type="color"
                    value={themeColorInput}
                    onChange={handleColorPick}
                    className="w-9 h-7 rounded cursor-pointer bg-transparent p-0 border-0 block"
                  />
                </label>
                <button
                  onClick={handleAutoExtract}
                  disabled={isExtracting}
                  className="btn-secondary h-9 px-3 rounded-lg disabled:opacity-50"
                  title={t("btn_auto_extract")}
                >
                  {isExtracting ? (
                    <Loader2 size={s(16)} className="animate-spin" />
                  ) : (
                    <Wand2 size={s(16)} />
                  )}
                </button>
              </div>
            </SettingsRow>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <RangeSlider
              label={t("label_blur")}
              value={bgBlurInput}
              min={0}
              max={40}
              step={1}
              unit="px"
              onChange={setBgBlurInput}
            />
            <RangeSlider
              label={t("glass_blur")}
              value={glassBlur}
              min={0}
              max={80}
              step={2}
              unit="px"
              onChange={setGlassBlur}
            />
            <RangeSlider
              label={t("glass_saturation")}
              value={glassSaturation}
              min={100}
              max={300}
              step={10}
              unit="%"
              onChange={setGlassSaturation}
            />
            <RangeSlider
              label={t("glass_noise")}
              value={glassNoise}
              min={0}
              max={1}
              step={0.05}
              onChange={setGlassNoise}
            />
            <RangeSlider
              label={t("glass_tint")}
              value={glassTint}
              min={0}
              max={1}
              step={0.05}
              onChange={setGlassTint}
            />
            </div>
          </div>
        </SettingsSection>

        {/* Global Tuning */}
        <SettingsSection
          icon={Type}
          title={t("global_tuning")}
          description={t("global_tuning_desc")}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RangeSlider
                label={t("radius_scale")}
                value={radiusScale}
                min={0}
                max={2}
                step={0.1}
                unit="x"
                onChange={setRadiusScale}
              />
              <RangeSlider
                label={t("density_scale")}
                value={densityScale}
                min={0.7}
                max={1.5}
                step={0.05}
                unit="x"
                onChange={setDensityScale}
              />
              <RangeSlider
                label={t("font_size_scale")}
                value={fontSize}
                min={0.8}
                max={1.3}
                step={0.05}
                unit="x"
                onChange={setFontSize}
              />
            </div>
            <SettingsRow label={t("font_weight")}>
              <SegmentedControl options={fontWeights} value={fontWeight} onChange={setFontWeight} />
            </SettingsRow>
            <SettingsRow label={t("nav_style_label")}>
              <SegmentedControl options={navStyles} value={navStyle} onChange={setNavStyle} />
            </SettingsRow>
            <SettingsRow label={t("search_style_label")}>
              <SegmentedControl
                options={searchStyles}
                value={searchStyle}
                onChange={setSearchStyle}
              />
            </SettingsRow>
          </div>
        </SettingsSection>

        {/* Layout */}
        <SettingsSection
          icon={Sliders}
          title={t("precision_controls")}
          description={t("geometry_layout")}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <RangeSlider
              label={t("canvas_width")}
              value={widthInput}
              min={600}
              max={1440}
              step={20}
              unit="px"
              onChange={setWidthInput}
            />
            <RangeSlider
              label={t("grid_cols")}
              value={colsInput}
              min={2}
              max={12}
              step={1}
              onChange={setColsInput}
            />
            <RangeSlider
              label={t("card_width")}
              value={cardWidthInput}
              min={60}
              max={200}
              step={4}
              unit="px"
              onChange={setCardWidthInput}
            />
            <RangeSlider
              label={t("card_height")}
              value={cardHeightInput}
              min={60}
              max={200}
              step={4}
              unit="px"
              onChange={setCardHeightInput}
            />
            <RangeSlider
              label={t("icon_scale")}
              value={iconScaleInput}
              min={20}
              max={60}
              step={2}
              unit="%"
              onChange={setIconScaleInput}
            />
            <RangeSlider
              label={t("surface_opacity")}
              value={opacityInput}
              min={0.05}
              max={0.85}
              step={0.05}
              onChange={setOpacityInput}
            />
          </div>
        </SettingsSection>

        {/* Animation System */}
        <SettingsSection
          icon={Sparkles}
          title={t("animation_system")}
          description={t("animation_system_desc")}
        >
          <div className="space-y-4">
            <SegmentedControl
              options={animLevels.map((l) => ({ value: l, label: t(`anim_${l}`) }))}
              value={animationLevel}
              onChange={setAnimationLevel}
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <RangeSlider
                label={t("anim_speed")}
                value={animationSpeed}
                min={0.3}
                max={2.0}
                step={0.1}
                unit="x"
                onChange={setAnimationSpeed}
              />
              <RangeSlider
                label={t("anim_stagger")}
                value={animationStagger}
                min={10}
                max={80}
                step={5}
                unit="ms"
                onChange={setAnimationStagger}
              />
            </div>
          </div>
        </SettingsSection>

        </div>

        <div className="h-14" />
      </SettingsContainer>

      {/* Floating action bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 p-2 rounded-2xl border border-white/10 shadow-2xl backdrop-blur-xl bg-black/30">
        <button
          onClick={handleResetBackground}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 transition-colors group"
        >
          <RotateCcw size={s(14)} className="group-active:rotate-[-90deg] transition-transform" />
          <span className="text-[10px] font-bold uppercase tracking-widest">
            {t("reset_bg_btn")}
          </span>
        </button>
        <button
          onClick={handleSave}
          className="btn-primary py-2 px-6 rounded-xl tracking-[0.2em] text-[11px]"
        >
          <Save size={s(14)} />
          <span>{t("update_bg_btn")}</span>
        </button>
      </div>

      {bgStatus && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[200] text-[10px] font-black uppercase tracking-[0.4em] text-emerald-400 animate-fade-in-up drop-shadow-[0_0_8px_rgba(52,211,153,0.5)] pointer-events-none">
          {bgStatus}
        </div>
      )}
    </>
  );
};
