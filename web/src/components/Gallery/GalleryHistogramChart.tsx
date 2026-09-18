import { useId } from "react";
import { useTranslate } from "@/utils/i18n";
import type { PhotoAnalysis } from "./preview-colors";

const CHANNELS = ["luminance", "red", "green", "blue"] as const;

export default function GalleryHistogramChart({ histogram }: { histogram: PhotoAnalysis["histogram"] }) {
  const t = useTranslate();
  const id = useId().replace(/:/g, "");
  const bins = Object.fromEntries(
    CHANNELS.map((channel) => [
      channel,
      Array.from({ length: 128 }, (_, index) => histogram[channel][index * 2] + histogram[channel][index * 2 + 1]),
    ]),
  ) as Record<(typeof CHANNELS)[number], number[]>;
  const maximum = Math.max(0, ...CHANNELS.flatMap((channel) => bins[channel]));

  return (
    <svg
      viewBox="0 0 256 128"
      preserveAspectRatio="none"
      className="h-32 w-full overflow-hidden rounded-sm border border-[var(--gallery-border)] bg-[var(--gallery-background)] backdrop-blur-2xl"
      role="img"
      aria-label={t("gallery.histogram-description")}
    >
      <title>{t("gallery.histogram-description")}</title>
      <defs>
        {CHANNELS.map((channel) => (
          <linearGradient key={channel} id={`${id}-${channel}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`var(--gallery-histogram-${channel})`} stopOpacity={channel === "luminance" ? 0.3 : 0.7} />
            <stop offset="100%" stopColor={`var(--gallery-histogram-${channel})`} stopOpacity={channel === "luminance" ? 0.03 : 0.07} />
          </linearGradient>
        ))}
      </defs>
      {[32, 64, 96].map((y) => (
        <line key={y} x1="0" x2="256" y1={y} y2={y} stroke="var(--gallery-border)" strokeWidth="0.5" />
      ))}
      {maximum > 0 &&
        CHANNELS.map((channel) => (
          <g key={channel} data-channel={channel} style={channel === "luminance" ? undefined : { mixBlendMode: "screen" }}>
            {bins[channel].map((count, bin) =>
              count > 0 ? (
                <rect
                  key={`${channel}-${bin * 2}`}
                  x={bin * 2}
                  y={128 - (count / maximum) * 128}
                  width="1.6"
                  height={(count / maximum) * 128}
                  fill={`url(#${id}-${channel})`}
                />
              ) : null,
            )}
          </g>
        ))}
    </svg>
  );
}
