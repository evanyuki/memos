import type { CSSProperties } from "react";

const BG_HEX = "#1c1c1e";

export type RGB = { r: number; g: number; b: number };

export const hexToRgb = (hex: string): RGB | null => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return null;
  return {
    r: Number.parseInt(m[1], 16),
    g: Number.parseInt(m[2], 16),
    b: Number.parseInt(m[3], 16),
  };
};

export const rgbToHex = ({ r, g, b }: RGB): string => {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

export const luminance = ({ r, g, b }: RGB): number => {
  const srgb = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0]! + 0.7152 * srgb[1]! + 0.0722 * srgb[2]!;
};

export const contrastRatio = (c1: RGB, c2: RGB): number => {
  const L1 = luminance(c1);
  const L2 = luminance(c2);
  const [a, b] = L1 >= L2 ? [L1, L2] : [L2, L1];
  return (a + 0.05) / (b + 0.05);
};

export const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

export const clampAccentContrast = (
  accent: RGB,
  bgHex: string = BG_HEX,
  { min = 2.2, max = 4.5 }: { min?: number; max?: number } = {},
): RGB => {
  const bg = hexToRgb(bgHex) ?? { r: 28, g: 28, b: 30 };
  const cr = contrastRatio(accent, bg);
  if (cr >= min && cr <= max) return accent;

  if (cr > max) {
    for (let t = 0.05; t <= 1; t += 0.05) {
      const candidate = mix(accent, bg, t);
      const c = contrastRatio(candidate, bg);
      if (c <= max) return candidate;
    }
    return mix(accent, bg, 0.8);
  }
  const white = { r: 255, g: 255, b: 255 };
  for (let t = 0.05; t <= 1; t += 0.05) {
    const candidate = mix(accent, white, t);
    const c = contrastRatio(candidate, bg);
    if (c >= min) return candidate;
  }
  return mix(accent, white, 0.8);
};

export function galleryAccentStyle(palette: string[] = []): CSSProperties | undefined {
  const color = hexToRgb(palette[0] ?? "");
  return color
    ? ({
        "--gallery-accent": rgbToHex(clampAccentContrast(color)),
        "--gallery-accent-secondary": palette[1] ?? palette[0],
      } as CSSProperties)
    : undefined;
}
