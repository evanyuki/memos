export interface PhotoHistogram {
  red: number[];
  green: number[];
  blue: number[];
  luminance: number[];
}

export interface PhotoToneAnalysis {
  toneType: "low-key" | "high-key" | "high-contrast" | "normal";
  brightness: number;
  contrast: number;
  shadowRatio: number;
  highlightRatio: number;
}

export interface PhotoAnalysis {
  palette: string[];
  histogram: PhotoHistogram;
  toneAnalysis: PhotoToneAnalysis;
}

// Adapted from Lifemory packages/builder/src/image/histogram.ts. Keep the
// BT.709 weights, tone thresholds, and rounding aligned with its analyzeTone.
function analyzeTone({ luminance }: PhotoHistogram): PhotoToneAnalysis {
  let totalLuminance = 0;
  let totalPixels = 0;
  for (const [i, element] of luminance.entries()) {
    totalLuminance += i * element;
    totalPixels += element;
  }
  const brightness = Math.round((totalLuminance / totalPixels) * (100 / 255));

  let shadowRatio = 0;
  let highlightRatio = 0;
  for (let i = 0; i < 86; i++) {
    shadowRatio += luminance[i];
  }
  for (let i = 170; i < 256; i++) {
    highlightRatio += luminance[i];
  }

  let variance = 0;
  const mean = totalLuminance / totalPixels;
  for (const [i, element] of luminance.entries()) {
    variance += element * (i - mean) ** 2;
  }
  const stdDev = Math.sqrt(variance);
  const contrast = Math.min(100, Math.round((stdDev / 127.5) * 100));

  let toneType: PhotoToneAnalysis["toneType"];
  if (brightness < 30 && shadowRatio > 0.6) {
    toneType = "low-key";
  } else if (brightness > 70 && highlightRatio > 0.6) {
    toneType = "high-key";
  } else if (contrast > 60 && shadowRatio > 0.3 && highlightRatio > 0.3) {
    toneType = "high-contrast";
  } else {
    toneType = "normal";
  }

  return {
    toneType,
    brightness,
    contrast,
    shadowRatio: Math.round(shadowRatio * 100) / 100,
    highlightRatio: Math.round(highlightRatio * 100) / 100,
  };
}

export function analyzePreviewPixels(pixels: Uint8ClampedArray): PhotoAnalysis | null {
  const colors = new Map<number, { count: number; red: number; green: number; blue: number }>();
  const histogram: PhotoHistogram = {
    red: Array<number>(256).fill(0),
    green: Array<number>(256).fill(0),
    blue: Array<number>(256).fill(0),
    luminance: Array<number>(256).fill(0),
  };
  let pixelCount = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    const weight = pixels[index + 3] / 255;
    if (!weight) continue;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const luminance = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    histogram.red[red] += weight;
    histogram.green[green] += weight;
    histogram.blue[blue] += weight;
    histogram.luminance[luminance] += weight;
    pixelCount += weight;

    const key = (Math.floor(red / 32) << 6) | (Math.floor(green / 32) << 3) | Math.floor(blue / 32);
    const color = colors.get(key) ?? { count: 0, red: 0, green: 0, blue: 0 };
    color.count += weight;
    color.red += red * weight;
    color.green += green * weight;
    color.blue += blue * weight;
    colors.set(key, color);
  }
  if (!pixelCount) return null;
  for (const channel of Object.values(histogram)) {
    for (let index = 0; index < channel.length; index++) {
      channel[index] /= pixelCount;
    }
  }

  const palette = [...colors.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(
      (color) =>
        `#${[color.red, color.green, color.blue]
          .map((value) =>
            Math.round(value / color.count)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
    );
  return { palette, histogram, toneAnalysis: analyzeTone(histogram) };
}
