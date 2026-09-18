import { useEffect, useRef } from "react";
import useMediaQuery from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { PreviewMediaItem } from "@/utils/media-item";

import { getGalleryPreviewSource } from "./gallery-media";

interface GalleryThumbnailStripProps {
  thumbnails: PreviewMediaItem[];
  currentIndex: number;
  onSelect: (index: number) => void;
}

const thumbnailRatio = (item: PreviewMediaItem) => {
  const metadata = item.attachments?.find(
    (attachment) => attachment.mediaMetadata?.width && attachment.mediaMetadata.height,
  )?.mediaMetadata;
  return metadata?.width && metadata.height ? metadata.width / metadata.height : 1;
};

export default function GalleryThumbnailStrip({ thumbnails, currentIndex, onSelect }: GalleryThumbnailStripProps) {
  const t = useTranslate();
  const stripRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const desktop = useMediaQuery("lg");
  const mobile = !desktop;
  const itemHeight = mobile ? 48 : 64;

  useEffect(() => {
    const active = itemRefs.current[currentIndex];
    if (!active) return;
    active.scrollIntoView?.({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [currentIndex, thumbnails.length]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) {
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      }
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div className="gallery-viewer-thumbnails relative shrink-0">
      <div ref={stripRef} className="scrollbar-none flex items-center overflow-x-auto" aria-label={t("gallery.title")}>
        {thumbnails.map((thumbnail, index) => (
          <button
            key={thumbnail.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            className={cn("gallery-viewer-thumbnail", index === currentIndex && "is-current")}
            style={{ width: itemHeight * thumbnailRatio(thumbnail), height: itemHeight }}
            aria-current={index === currentIndex ? "true" : undefined}
            aria-label={thumbnail.filename}
            onClick={() => onSelect(index)}
          >
            <img src={getGalleryPreviewSource(thumbnail)} alt="" className="size-full object-cover" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    </div>
  );
}
