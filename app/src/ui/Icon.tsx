import React, { memo } from "react";
import { SvgXml } from "react-native-svg";
import { useColors } from "../theme/ThemeProvider";
import { ICONS, type IconName } from "./iconPaths";

export type { IconName };

type Props = { name: IconName; size?: number; strokeWidth?: number; color?: string };

export const Icon = memo(function Icon({ name, size = 24, strokeWidth = 1.8, color }: Props) {
  const c = useColors();
  const xml = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color ?? c.ink}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return <SvgXml xml={xml} width={size} height={size} />;
});
