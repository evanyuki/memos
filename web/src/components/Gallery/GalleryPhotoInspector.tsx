import { CheckIcon, CopyIcon, MapIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { LazyLocationPicker } from "@/components/map/LazyLocationPicker";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import useMediaQuery from "@/hooks/useMediaQuery";
import { usePhotoAnalysis } from "@/hooks/usePhotoAnalysis";
import { cn } from "@/lib/utils";
import { formatFileSize, getFileTypeLabel } from "@/utils/format";
import { useTranslate } from "@/utils/i18n";
import type { PreviewMediaItem } from "@/utils/media-item";
import { buildMediaMetadataDisplay } from "@/utils/media-metadata";
import { GalleryExifSection as InspectorSection, GalleryExifRow as Row } from "./GalleryExifSection";
import GalleryHistogramChart from "./GalleryHistogramChart";
import { galleryAccentStyle } from "./gallery-accent";
import { getGalleryPreviewSource } from "./gallery-media";

interface GalleryPhotoInspectorProps {
  id: string;
  item: PreviewMediaItem;
  onClose: () => void;
  children?: ReactNode;
}

const actionClass =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--gallery-muted)] hover:bg-[var(--gallery-fill)] hover:text-[var(--gallery-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gallery-accent)]";

export default function GalleryPhotoInspector({ id, item, onClose, children }: GalleryPhotoInspectorProps) {
  const t = useTranslate();
  const desktop = useMediaQuery("lg");
  const [showMap, setShowMap] = useState(false);
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const locale = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const primary = item.attachments?.find((attachment) => attachment.type.startsWith("image/")) ?? item.attachments?.[0];
  const details = useMemo(() => buildMediaMetadataDisplay(item.attachments, locale), [item.attachments, locale]);
  const source = getGalleryPreviewSource(item);
  const analysis = usePhotoAnalysis(source);
  const size = primary?.mediaMetadata?.width && primary.mediaMetadata.height ? primary.mediaMetadata : undefined;
  const tone = analysis.data?.toneAnalysis;
  const style = galleryAccentStyle(analysis.data?.palette);
  const cameraRows = [
    [t("attachment-details.fields.camera"), details.camera],
    [t("attachment-details.fields.lens"), details.lens],
    [t("gallery.focal-length-equivalent"), details.focalLengthEquivalent],
    [t("gallery.exposure-program"), details.exposureProgram],
    [t("gallery.metering-mode"), details.meteringMode],
  ];
  const colorRows = [
    [t("gallery.color-space"), details.colorSpace],
    [t("gallery.icc-profile"), details.iccProfile],
    [t("gallery.bit-depth"), details.bitDepth],
    [t("gallery.white-balance"), details.whiteBalance],
  ];

  useEffect(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    setShowMap(false);
    setCopied(false);
  }, [item.id]);

  const copyCoordinates = async () => {
    if (!details.location) return;
    try {
      await navigator.clipboard.writeText(`${details.location.latitude}, ${details.location.longitude}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const content = (
    <>
      <header className="relative z-10 flex h-14 shrink-0 items-center justify-between gap-2 px-4">
        {desktop ? (
          <h2 className="text-lg font-semibold">{t("gallery.inspector-title")}</h2>
        ) : (
          <SheetTitle className="text-lg text-[var(--gallery-foreground)]">{t("gallery.inspector-title")}</SheetTitle>
        )}
        <div className="flex items-center">
          <button ref={closeRef} type="button" className={actionClass} aria-label={t("attachment-details.actions.hide")} onClick={onClose}>
            <XIcon className="size-4" />
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] select-text">
        {children}
        <InspectorSection title={t("gallery.basic-information")}>
          <dl className="space-y-1">
            <Row label={t("gallery.filename")} value={item.filename} truncate />
            {primary && <Row label={t("gallery.format")} value={getFileTypeLabel(primary.type)} />}
            {size?.width && size.height ? (
              <Row label={t("attachment-details.fields.dimensions")} value={`${size.width} × ${size.height}`} />
            ) : null}
            {primary && <Row label={t("gallery.file-size")} value={formatFileSize(Number(primary.size))} />}
            {size?.width && size.height ? (
              <Row
                label={t("gallery.pixels")}
                value={`${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format((size.width * size.height) / 1_000_000)} MP`}
              />
            ) : null}
            {details.captured && <Row label={t("attachment-details.fields.captured")} value={details.captured} />}
            {details.captured && (
              <Row
                label={t("gallery.time-zone")}
                value={
                  details.utcOffset
                    ? details.utcOffset === "Z"
                      ? "UTC"
                      : `UTC${details.utcOffset}`
                    : t("attachment-details.timezone-unknown")
                }
              />
            )}
          </dl>
        </InspectorSection>
        {details.exposure && (
          <InspectorSection title={t("attachment-details.fields.exposure")}>
            <div className="grid grid-cols-2 gap-2 text-xs tabular-nums">
              {[...details.exposure.split(" · "), details.exposureBias].filter(Boolean).map((value) => (
                <span key={value} className="rounded-md border border-[var(--gallery-border)] bg-[var(--gallery-fill)] px-2 py-1">
                  {value}
                </span>
              ))}
            </div>
          </InspectorSection>
        )}
        {tone && (
          <InspectorSection title={t("gallery.tone-analysis")}>
            <dl className="space-y-1">
              <Row label={t("gallery.tone-type")} value={t(`gallery.tone-${tone.toneType}`)} />
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <Row label={t("gallery.brightness")} value={`${tone.brightness}%`} />
                <Row label={t("gallery.contrast")} value={`${tone.contrast}%`} />
                <Row label={t("gallery.shadow-ratio")} value={`${Math.round(tone.shadowRatio * 100)}%`} />
                <Row label={t("gallery.highlight-ratio")} value={`${Math.round(tone.highlightRatio * 100)}%`} />
              </div>
            </dl>
          </InspectorSection>
        )}
        {analysis.data && (
          <InspectorSection title={t("gallery.histogram")}>
            <GalleryHistogramChart histogram={analysis.data.histogram} />
            <p className="text-xs text-[var(--gallery-muted)]">{t("gallery.preview-analysis")}</p>
          </InspectorSection>
        )}
        {cameraRows.some(([, value]) => value) && (
          <InspectorSection title={t("attachment-details.sections.camera")}>
            <dl className="space-y-1">
              {cameraRows.map(([label, value]) => (value ? <Row key={label} label={label!} value={value} /> : null))}
            </dl>
          </InspectorSection>
        )}
        {colorRows.some(([, value]) => value) && (
          <InspectorSection title={t("gallery.colors")}>
            <dl className="space-y-1">
              {colorRows.map(([label, value]) => (value ? <Row key={label} label={label!} value={value} /> : null))}
            </dl>
          </InspectorSection>
        )}
        {details.location && (
          <InspectorSection title={t("attachment-details.sections.location")}>
            <dl className="space-y-1">
              <Row label={t("attachment-details.fields.location")} value={details.location.coordinates} />
              {details.location.altitude && <Row label={t("attachment-details.fields.altitude")} value={details.location.altitude} />}
            </dl>
            <div className="flex gap-2">
              <button
                type="button"
                className={actionClass}
                aria-label={t(copied ? "attachment-details.actions.copied" : "attachment-details.actions.copy-coordinates")}
                onClick={() => void copyCoordinates()}
              >
                {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
              </button>
              <button
                type="button"
                className={cn(actionClass, "w-auto gap-2 px-2 text-xs")}
                aria-expanded={showMap}
                onClick={() => setShowMap(!showMap)}
              >
                <MapIcon className="size-4" />
                {t(showMap ? "attachment-details.actions.hide-map" : "attachment-details.actions.show-map")}
              </button>
            </div>
            {showMap && (
              <LazyLocationPicker
                className="h-44 rounded-xl"
                latlng={{ lat: details.location.latitude, lng: details.location.longitude }}
                readonly
              />
            )}
          </InspectorSection>
        )}
        {!details.hasSavedMetadata && <p className="text-xs leading-5 text-[var(--gallery-muted)]">{t("attachment-details.empty")}</p>}
        {details.sourceExifOrientation !== undefined && (
          <dl>
            <Row label={t("attachment-details.fields.source-orientation")} value={String(details.sourceExifOrientation)} />
          </dl>
        )}
      </div>
    </>
  );

  return desktop ? (
    <aside
      id={id}
      aria-label={t("gallery.inspector-title")}
      className="gallery-inspector relative z-30 flex w-80 shrink-0 flex-col overflow-hidden border-l border-[var(--gallery-border)] bg-[var(--gallery-material)] text-[var(--gallery-foreground)] backdrop-blur-2xl"
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {content}
    </aside>
  ) : (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        id={id}
        side="bottom"
        initialFocus={closeRef}
        finalFocus={returnFocus}
        style={style}
        className="gallery-theme gallery-inspector mx-auto h-[65dvh] max-h-[85dvh] w-full max-w-screen-lg gap-0 overflow-hidden rounded-t-2xl border-[var(--gallery-border)] bg-[var(--gallery-material)] text-[var(--gallery-foreground)] shadow-none backdrop-blur-2xl !transition-none [&>button:last-child]:hidden"
      >
        <SheetDescription className="sr-only">{item.filename}</SheetDescription>
        <div className="mx-auto mt-3 h-1.5 w-11 shrink-0 rounded-full bg-[var(--gallery-fill)]" aria-hidden="true" />
        {content}
      </SheetContent>
    </Sheet>
  );
}
