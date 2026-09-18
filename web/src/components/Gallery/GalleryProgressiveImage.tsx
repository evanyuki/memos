import { type PointerEvent, useCallback, useEffect, useRef, useState } from "react";
import MotionPhotoPreview from "@/components/MotionPhotoPreview";
import { cn } from "@/lib/utils";
import type { PreviewMediaItem } from "@/utils/media-item";
import GalleryContainedImageFrame from "./GalleryContainedImageFrame";
import { getGalleryPreviewSource } from "./gallery-media";

interface GalleryProgressiveImageProps {
  item: PreviewMediaItem;
  alt: string;
  className?: string;
  onZoomChange?: (zoomed: boolean) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const dimensions = (item: PreviewMediaItem) => {
  const metadata = item.attachments?.find(
    (attachment) => attachment.mediaMetadata?.width && attachment.mediaMetadata.height,
  )?.mediaMetadata;
  return { width: metadata?.width, height: metadata?.height };
};

export default function GalleryProgressiveImage({ item, alt, className, onZoomChange }: GalleryProgressiveImageProps) {
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false);
  const [highResolutionLoaded, setHighResolutionLoaded] = useState(false);
  const [highResolutionError, setHighResolutionError] = useState(false);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; scale: number } | undefined>(undefined);
  const dragRef = useRef<{ pointerId: number; x: number; y: number } | undefined>(undefined);
  const thumbnail = getGalleryPreviewSource(item);
  const highResolution = item.kind === "image" ? item.sourceUrl : (item.posterUrl ?? "");
  const size = dimensions(item);
  const isImage = item.kind === "image";

  useEffect(() => {
    setThumbnailLoaded(false);
    setHighResolutionLoaded(false);
    setHighResolutionError(false);
    setScale(1);
    setPan({ x: 0, y: 0 });
    onZoomChange?.(false);
  }, [item.id, onZoomChange]);

  const clampPan = useCallback(
    (next: { x: number; y: number }, nextScale = scale) => {
      const stage = stageRef.current;
      if (!stage || nextScale <= 1) return { x: 0, y: 0 };
      const maxX = (stage.clientWidth * (nextScale - 1)) / 2;
      const maxY = (stage.clientHeight * (nextScale - 1)) / 2;
      return { x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY) };
    },
    [scale],
  );

  const setZoom = useCallback(
    (next: number) => {
      const value = clamp(next, 1, 20);
      setScale(value);
      setPan((current) => clampPan(current, value));
      onZoomChange?.(value > 1);
    },
    [clampPan, onZoomChange],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !isImage) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom(scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    stage.addEventListener("wheel", wheel, { passive: false });
    return () => stage.removeEventListener("wheel", wheel);
  }, [isImage, scale, setZoom]);

  const handleDoubleClick = () => {
    if (isImage) setZoom(scale > 1 ? 1 : 2);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!isImage) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (pointersRef.current.size === 2) {
      const points = [...pointersRef.current.values()];
      pinchRef.current = { distance: Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y), scale };
      dragRef.current = undefined;
    } else if (scale > 1) {
      dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = pointersRef.current.get(event.pointerId);
    if (point) {
      point.x = event.clientX;
      point.y = event.clientY;
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const points = [...pointersRef.current.values()];
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      if (pinchRef.current.distance > 0) setZoom((pinchRef.current.scale * distance) / pinchRef.current.distance);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    setPan((current) => clampPan({ x: current.x + dx, y: current.y + dy }));
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = undefined;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  if (item.kind === "motion") {
    return (
      <div className={cn("relative flex size-full items-center justify-center", className)} data-gallery-progressive-image="motion">
        <MotionPhotoPreview
          posterUrl={item.posterUrl}
          motionUrl={item.motionUrl}
          presentationTimestampUs={item.presentationTimestampUs}
          alt={alt}
          mediaClassName="max-h-full max-w-full object-contain"
          containerClassName="flex max-h-full max-w-full items-center justify-center"
        />
      </div>
    );
  }

  if (item.kind === "video") {
    return (
      <div className={cn("relative flex size-full items-center justify-center", className)} data-gallery-progressive-image="video">
        <video
          key={item.id}
          src={item.sourceUrl}
          poster={item.posterUrl}
          className="max-h-full max-w-full object-contain"
          controls
          autoPlay
          playsInline
        />
      </div>
    );
  }

  return (
    <div
      ref={stageRef}
      className={cn("relative size-full overflow-hidden", className, scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in")}
      data-gallery-progressive-image="image"
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      style={{ touchAction: "none" }}
    >
      <GalleryContainedImageFrame width={size.width} height={size.height} className="absolute inset-0">
        <img
          src={thumbnail}
          alt={highResolutionError ? alt : ""}
          aria-hidden={!highResolutionError}
          className={cn(
            "absolute inset-0 block size-full object-contain transition-opacity duration-300",
            thumbnailLoaded ? "opacity-100" : "opacity-0",
          )}
          style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`, transformOrigin: "center" }}
          onLoad={() => setThumbnailLoaded(true)}
          draggable={false}
          decoding="async"
        />
        {!highResolutionError && (
          <img
            src={highResolution}
            alt={alt}
            className={cn(
              "absolute inset-0 block size-full select-none object-contain transition-opacity duration-300",
              highResolutionLoaded ? "opacity-100" : "opacity-0",
            )}
            style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`, transformOrigin: "center" }}
            onLoad={() => setHighResolutionLoaded(true)}
            onError={() => setHighResolutionError(true)}
            draggable={false}
            decoding="async"
          />
        )}
      </GalleryContainedImageFrame>
      {scale > 1 && (
        <span
          className="pointer-events-none absolute bottom-4 left-4 rounded-md border border-white/10 bg-black/45 px-2.5 py-1 text-sm text-white backdrop-blur-md"
          aria-live="polite"
        >
          {scale.toFixed(1)}x
        </span>
      )}
    </div>
  );
}
