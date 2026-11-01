import { useState, useEffect } from "react";

/**
 * Number of cards rendered per row.
 *
 * The admin "cards per row" setting (maxColumns) is authoritative on
 * tablet/desktop viewports (>= 768px): the grid renders exactly that many
 * columns and the cards stretch (grid minmax(0, 1fr)). Only on narrow phone
 * screens is the count clamped to what physically fits, so cards stay usable.
 */
export const useResponsiveColumns = (
  maxColumns: number,
  _maxContainerWidth: number,
  targetCardWidth: number
) => {
  const [effectiveColumns, setEffectiveColumns] = useState(maxColumns);

  useEffect(() => {
    const handleResize = () => {
      const windowWidth = window.innerWidth;

      if (windowWidth >= 768) {
        setEffectiveColumns(maxColumns);
        return;
      }

      // Narrow screens: fit as many columns as the card width allows (min 2).
      const containerPadding = 32;
      const gap = 16;
      const effectiveCardWidth = targetCardWidth || 124;
      const minColumnWidth = effectiveCardWidth + gap;
      let fit = Math.floor((windowWidth - containerPadding) / minColumnWidth);
      if (fit < 2) fit = 2;
      setEffectiveColumns(Math.min(fit, maxColumns));
    };

    // Initial calculation
    handleResize();

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [maxColumns, targetCardWidth]);

  return effectiveColumns;
};
