import { ChevronLeftIcon, ChevronRightIcon, InfoIcon, Share2Icon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { usePhotoAnalysis } from "@/hooks/usePhotoAnalysis";
import { useTranslate } from "@/utils/i18n";
import type { PreviewMediaItem } from "@/utils/media-item";
import GalleryPhotoInspector from "./GalleryPhotoInspector";
import GalleryProgressiveImage from "./GalleryProgressiveImage";
import GalleryThumbnailStrip from "./GalleryThumbnailStrip";
import { galleryAccentStyle } from "./gallery-accent";
import { getGalleryPreviewSource } from "./gallery-media";

interface GalleryPhotoViewerProps {
  item: PreviewMediaItem;
  thumbnails: PreviewMediaItem[];
  currentIndex: number;
  showInspector: boolean;
  onInspectorChange: (open: boolean) => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onSelect: (index: number) => void;
  onShare?: () => void;
  inspectorContent: ReactNode;
  children?: ReactNode;
}

export default function GalleryPhotoViewer({
  item,
  thumbnails,
  currentIndex,
  showInspector,
  onInspectorChange,
  onClose,
  onPrevious,
  onNext,
  onSelect,
  onShare,
  inspectorContent,
  children,
}: GalleryPhotoViewerProps) {
  const t = useTranslate();
  const [imageZoomed, setImageZoomed] = useState(false);
  const source = getGalleryPreviewSource(item);
  const analysis = usePhotoAnalysis(source);
  const style = galleryAccentStyle(analysis.data?.palette);

  return (
    <Dialog
      open
      onOpenChange={(nextOpen, eventDetails) => {
        if (nextOpen) return;
        if (showInspector && eventDetails.reason === "escape-key") {
          eventDetails.cancel();
          onInspectorChange(false);
        } else onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus
        className="gallery-theme gallery-viewer !fixed !inset-0 !top-0 !left-0 !h-[100dvh] !w-[100dvw] !max-h-none !max-w-none !translate-x-0 !translate-y-0 overflow-hidden rounded-none border-0 !p-0 shadow-none !transition-none [&>div:first-child]:h-full [&>div:first-child]:gap-0 [&>div:first-child]:overflow-hidden"
        style={style}
        onKeyDown={(event) => {
          if (event.defaultPrevented || imageZoomed || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (
            event.target instanceof HTMLElement &&
            (event.target.closest("input,textarea,select,[contenteditable=true],aside") ||
              event.target.closest("[role=dialog]") !== event.currentTarget)
          )
            return;
          if (event.key === "ArrowLeft" && onPrevious) {
            event.preventDefault();
            onPrevious();
          }
          if (event.key === "ArrowRight" && onNext) {
            event.preventDefault();
            onNext();
          }
        }}
      >
        <VisuallyHidden>
          <DialogTitle>{item.filename}</DialogTitle>
          <DialogDescription>{t("gallery.open-viewer")}</DialogDescription>
        </VisuallyHidden>
        <div className="group/gallery-viewer relative flex size-full min-h-0 flex-col lg:flex-row">
          <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
              <img src={source} alt="" className="gallery-viewer-photo-backdrop size-full object-cover" />
            </div>
            <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between p-3 lg:p-4">
              <div className="min-w-0 truncate pr-3 text-sm text-white" title={item.filename}>
                {item.filename.replace(/\.[^.]+$/, "")}
              </div>
              <div className="pointer-events-auto ml-auto flex shrink-0 items-center gap-2">
                {onShare && (
                  <button type="button" className="gallery-viewer-button" aria-label={t("common.share")} onClick={onShare}>
                    <Share2Icon className="size-4" aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="gallery-viewer-button"
                  aria-label={t(showInspector ? "attachment-details.actions.hide" : "attachment-details.actions.show")}
                  aria-pressed={showInspector}
                  onClick={() => onInspectorChange(!showInspector)}
                >
                  <InfoIcon className="size-4" aria-hidden="true" />
                </button>
                <button type="button" className="gallery-viewer-button" aria-label={t("common.close")} onClick={onClose}>
                  <XIcon className="size-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="gallery-viewer-stage relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              <GalleryProgressiveImage item={item} alt={item.filename} onZoomChange={setImageZoomed} className="size-full" />
              {onPrevious && (
                <button
                  type="button"
                  className="gallery-viewer-nav left-4"
                  aria-label={t("gallery.previous")}
                  onClick={onPrevious}
                  disabled={imageZoomed}
                >
                  <ChevronLeftIcon className="size-5" aria-hidden="true" />
                </button>
              )}
              {onNext && (
                <button
                  type="button"
                  className="gallery-viewer-nav right-4"
                  aria-label={t("gallery.next")}
                  onClick={onNext}
                  disabled={imageZoomed}
                >
                  <ChevronRightIcon className="size-5" aria-hidden="true" />
                </button>
              )}
            </div>
            {thumbnails.length > 1 && <GalleryThumbnailStrip thumbnails={thumbnails} currentIndex={currentIndex} onSelect={onSelect} />}
          </div>
          {showInspector && (
            <GalleryPhotoInspector id="gallery-photo-viewer-inspector" item={item} onClose={() => onInspectorChange(false)}>
              {inspectorContent}
            </GalleryPhotoInspector>
          )}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
