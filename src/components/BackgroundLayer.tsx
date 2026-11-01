import React from "react";
import { useResolvedBackground } from "../hooks/useResolvedBackground";

interface BackgroundLayerProps {
  background: string;
  /** Background image blur in px (0 = off). */
  bgBlur?: number;
}

export const BackgroundLayer: React.FC<BackgroundLayerProps> = ({ background, bgBlur = 0 }) => {
  const resolved = useResolvedBackground(background);
  const isBackgroundUrl = resolved.startsWith("http") || resolved.startsWith("data:");
  // Blur bleeds transparent edges inward, so overscan the image proportionally
  // to keep the blurred background full-bleed.
  const blurPx = Math.max(0, bgBlur);
  const imgStyle: React.CSSProperties =
    blurPx > 0
      ? { filter: `blur(${blurPx}px)`, transform: `scale(${1 + (blurPx * 2) / 100})` }
      : {};

  return (
    <div className="fixed inset-0 z-0">
      {isBackgroundUrl ? (
        <img
          src={resolved}
          alt="Background"
          className="w-full h-full object-cover transition-opacity duration-700 opacity-100 dark:opacity-80"
          style={imgStyle}
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = "0";
          }}
        />
      ) : (
        <div
          className="w-full h-full transition-opacity duration-700 opacity-90 dark:opacity-100"
          style={{ background: resolved }}
        />
      )}
      <div className="absolute inset-0 transition-colors duration-500 bg-white/10 dark:bg-slate-900/30" />
    </div>
  );
};
