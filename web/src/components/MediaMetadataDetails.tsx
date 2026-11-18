import {
  ApertureIcon,
  CalendarArrowUpIcon,
  CalendarClockIcon,
  CameraIcon,
  FileType2Icon,
  FocusIcon,
  type LucideIcon,
  PaletteIcon,
  RotateCwIcon,
  ScanIcon,
  TimerIcon,
  XIcon,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import i18n from "@/i18n";
import { useTranslate } from "@/utils/i18n";
import type { PreviewMediaItem } from "@/utils/media-item";
import { buildMediaMetadataDisplay } from "@/utils/media-metadata";

interface DetailRowProps {
  icon: LucideIcon;
  label: string;
  value: string;
  secondary?: string;
}

interface MediaMetadataDetailsProps {
  id: string;
  item: PreviewMediaItem;
  onClose: () => void;
}

const DetailRow = ({ icon: Icon, label, value, secondary }: DetailRowProps) => (
  <div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-x-2.5 py-2.5">
    <Icon className="mt-0.5 size-3.5 text-white/38" strokeWidth={1.75} aria-hidden="true" />
    <div className="min-w-0">
      <div className="text-[11px] font-medium leading-4 text-white/45">{label}</div>
      <div className="mt-0.5 break-words text-[13px] leading-5 text-white/88 tabular-nums">{value}</div>
      {secondary && <div className="mt-0.5 text-[11px] leading-4 text-white/48">{secondary}</div>}
    </div>
  </div>
);

const DetailSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <h3 className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/32">{title}</h3>
    <div className="divide-y divide-white/[0.07]">{children}</div>
  </section>
);

const MediaMetadataDetails = ({ id, item, onClose }: MediaMetadataDetailsProps) => {
  const t = useTranslate();
  const locale = i18n.language;
  const details = useMemo(() => buildMediaMetadataDisplay(item.attachments, locale), [item.attachments, locale]);

  const hasCameraDetails = Boolean(
    details.camera ||
      details.lens ||
      details.exposure ||
      details.exposureBias ||
      details.exposureProgram ||
      details.meteringMode ||
      details.focalLengthEquivalent,
  );

  return (
    <aside
      id={id}
      aria-label={t("attachment-details.title")}
      className="absolute inset-x-0 bottom-0 z-40 flex max-h-[72vh] flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-neutral-950/96 text-white shadow-2xl backdrop-blur-xl lg:inset-y-0 lg:left-auto lg:w-[22rem] lg:max-h-none lg:rounded-none lg:border-l lg:border-t-0 lg:bg-black/82"
    >
      <div className="mx-auto mt-2 h-1 w-8 rounded-full bg-white/18 lg:hidden" aria-hidden="true" />
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 pb-3 pt-3 lg:pt-20">
        <h2 className="text-sm font-medium text-white/92">{t("attachment-details.title")}</h2>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-8 items-center justify-center rounded-full text-white/55 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/45 lg:hidden"
          aria-label={t("attachment-details.actions.hide")}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      </header>

      <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <div className="space-y-5">
          {details.file && (
            <DetailSection title={t("attachment-details.sections.file")}>
              <DetailRow icon={FileType2Icon} label={t("attachment-details.fields.file")} value={details.file} />
              {details.dimensions && (
                <DetailRow icon={ScanIcon} label={t("attachment-details.fields.dimensions")} value={details.dimensions} />
              )}
              {details.duration && <DetailRow icon={TimerIcon} label={t("attachment-details.fields.duration")} value={details.duration} />}
              {details.uploaded && (
                <DetailRow icon={CalendarArrowUpIcon} label={t("attachment-details.fields.uploaded")} value={details.uploaded} />
              )}
            </DetailSection>
          )}

          {details.captured && (
            <DetailSection title={t("attachment-details.sections.capture")}>
              <DetailRow
                icon={CalendarClockIcon}
                label={t("attachment-details.fields.captured")}
                value={details.captured}
                secondary={details.timeZone ?? t("attachment-details.timezone-unknown")}
              />
            </DetailSection>
          )}

          {hasCameraDetails && (
            <DetailSection title={t("attachment-details.sections.camera")}>
              {details.camera && <DetailRow icon={CameraIcon} label={t("attachment-details.fields.camera")} value={details.camera} />}
              {details.lens && <DetailRow icon={FocusIcon} label={t("attachment-details.fields.lens")} value={details.lens} />}
              {details.exposure && (
                <DetailRow icon={ApertureIcon} label={t("attachment-details.fields.exposure")} value={details.exposure.join(" · ")} />
              )}
              {details.exposureBias && <DetailRow icon={ApertureIcon} label={t("gallery.exposure-bias")} value={details.exposureBias} />}
              {details.exposureProgram && (
                <DetailRow icon={CameraIcon} label={t("gallery.exposure-program")} value={details.exposureProgram} />
              )}
              {details.meteringMode && <DetailRow icon={FocusIcon} label={t("gallery.metering-mode")} value={details.meteringMode} />}
              {details.focalLengthEquivalent && (
                <DetailRow icon={FocusIcon} label={t("gallery.focal-length-equivalent")} value={details.focalLengthEquivalent} />
              )}
            </DetailSection>
          )}

          {(details.colorSpace || details.iccProfile || details.bitDepth || details.whiteBalance) && (
            <DetailSection title={t("gallery.colors")}>
              {details.colorSpace && <DetailRow icon={PaletteIcon} label={t("gallery.color-space")} value={details.colorSpace} />}
              {details.iccProfile && <DetailRow icon={PaletteIcon} label={t("gallery.icc-profile")} value={details.iccProfile} />}
              {details.bitDepth && <DetailRow icon={PaletteIcon} label={t("gallery.bit-depth")} value={details.bitDepth} />}
              {details.whiteBalance && <DetailRow icon={PaletteIcon} label={t("gallery.white-balance")} value={details.whiteBalance} />}
            </DetailSection>
          )}

          {details.sourceExifOrientation !== undefined && (
            <details className="group border-t border-white/[0.08] pt-3">
              <summary className="cursor-pointer select-none text-[11px] font-medium text-white/42 hover:text-white/65">
                {t("attachment-details.sections.technical")}
              </summary>
              <div className="mt-2">
                <DetailRow
                  icon={RotateCwIcon}
                  label={t("attachment-details.fields.source-orientation")}
                  value={String(details.sourceExifOrientation)}
                />
              </div>
            </details>
          )}
        </div>
      </div>
    </aside>
  );
};

export default MediaMetadataDetails;
