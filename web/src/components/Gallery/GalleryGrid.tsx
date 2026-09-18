import { CameraIcon, LoaderCircleIcon, LockKeyholeIcon, PlayIcon } from "lucide-react";
import { Masonry, type RenderComponentProps } from "masonic";
import { createContext, useContext, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useGalleryInfiniteLoading } from "@/hooks/useGalleryInfiniteLoading";
import { type GalleryPhoto, readGalleryFilters, useGalleryPhotos } from "@/hooks/useGalleryQueries";
import useMediaQuery from "@/hooks/useMediaQuery";
import { findTagMetadata } from "@/lib/tag";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl, isMotionAttachment } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import GalleryPageHeader from "./GalleryPageHeader";

const photoUid = (photo: GalleryPhoto) => photo.attachment.name.split("/").pop()!;
const GalleryNavigationContext = createContext<string[]>([]);

function GalleryCard({ data: photo, width }: RenderComponentProps<GalleryPhoto>) {
  const t = useTranslate();
  const { userTagsSetting } = useAuth();
  const photoUids = useContext(GalleryNavigationContext);
  const [params] = useSearchParams();
  const [revealed, setRevealed] = useState(false);
  const blurred = photo.memo.tags.some((tag) => userTagsSetting && findTagMetadata(tag, userTagsSetting)?.blurContent) && !revealed;
  const metadata = photo.attachment.mediaMetadata;
  const uid = photoUid(photo);
  const ratio = metadata?.width && metadata.height ? metadata.width / metadata.height : 4 / 3;
  return (
    <article className="group relative overflow-hidden bg-[var(--gallery-fill)]" style={{ width, height: width / ratio }}>
      <Link
        to={`/gallery/photos/${encodeURIComponent(uid)}${params.size ? `?${params}` : ""}`}
        state={{ photoUids, galleryReturn: true }}
        aria-label={photo.attachment.filename}
        tabIndex={blurred ? -1 : undefined}
        className="block size-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--gallery-accent)]"
      >
        <img
          src={getAttachmentThumbnailUrl(photo.attachment)}
          alt={blurred ? "" : photo.attachment.filename}
          loading="lazy"
          decoding="async"
          className={cn("block size-full object-cover", blurred && "blur-xl")}
        />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-linear-to-t from-black/80 to-transparent px-3 pb-3 pt-12 text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{photo.attachment.filename.replace(/\.[^.]+$/, "")}</p>
            {photo.memo.tags.length > 0 && (
              <p className="mt-1 truncate text-xs text-white/70">{photo.memo.tags.map((tag) => `#${tag}`).join(" ")}</p>
            )}
          </div>
          {photo.memo.visibility !== Visibility.PUBLIC && (
            <LockKeyholeIcon className="size-3.5 shrink-0" aria-label={t("gallery.non-public")} />
          )}
        </div>
        {isMotionAttachment(photo.attachment) && (
          <span
            className="absolute left-2 top-2 rounded-full border border-white/10 bg-black/40 p-1.5 text-white backdrop-blur-md"
            aria-label={t("gallery.motion-photo")}
          >
            <PlayIcon className="size-3" aria-hidden="true" />
          </span>
        )}
      </Link>
      {blurred && (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="absolute inset-0 flex items-center justify-center bg-black/55 p-4 text-center text-sm text-white focus-visible:ring-2 focus-visible:ring-[var(--gallery-accent)]"
        >
          {t("memo.click-to-show-sensitive-content")}
        </button>
      )}
    </article>
  );
}

export default function GalleryGrid() {
  const t = useTranslate();
  const [params] = useSearchParams();
  const filters = readGalleryFilters(params);
  const query = useGalleryPhotos(filters);
  const desktop = useMediaQuery("lg");
  const loadError = query.isError && !query.isFetchNextPageError;
  const uniquePhotos = useMemo(
    () =>
      loadError
        ? []
        : [...new Map((query.data?.pages.flatMap((page) => page.photos) ?? []).map((photo) => [photo.attachment.name, photo])).values()],
    [query.data, loadError],
  );
  const [layout, setLayout] = useState({ photos: uniquePhotos, version: 0 });
  if (layout.photos !== uniquePhotos) {
    // Appending pages keeps measured cells. Refetches that remove, reorder, or resize
    // existing photos must clear masonic's index-based position cache.
    const preservesPositions = layout.photos.every((photo, index) => {
      const next = uniquePhotos[index]?.attachment;
      return next?.name === photo.attachment.name && next.mediaMetadata === photo.attachment.mediaMetadata;
    });
    setLayout({ photos: uniquePhotos, version: layout.version + (preservesPositions ? 0 : 1) });
  }
  const onRender = useGalleryInfiniteLoading({
    resetKey: `${params}:${layout.version}`,
    nextPageToken: query.data?.pages.at(-1)?.nextPageToken ?? "",
    itemCount: uniquePhotos.length,
    hasNextPage: query.hasNextPage,
    isFetching: query.isFetching,
    isError: query.isError,
    fetchNextPage: query.fetchNextPage,
  });
  const ids = uniquePhotos.map(photoUid);
  return (
    <div className="gallery-grid-page">
      <GalleryPageHeader photoCount={uniquePhotos.length} />
      {query.isPending && (
        <div role="status" className="flex justify-center py-20">
          <LoaderCircleIcon className="size-6 animate-spin" aria-label={t("resource.fetching-data")} />
        </div>
      )}
      {loadError && (
        <div role="alert" className="py-10 text-center">
          <p className="mb-3 text-muted-foreground">{t("gallery.load-error")}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("gallery.retry")}
          </Button>
        </div>
      )}
      {!query.isPending && !query.isError && uniquePhotos.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground">
          <CameraIcon className="size-9" strokeWidth={1} />
          <p>{t(query.hasNextPage ? "gallery.empty-page" : "gallery.empty")}</p>
        </div>
      )}
      <GalleryNavigationContext value={ids}>
        <div className="p-1">
          <Masonry
            key={`${params}:${layout.version}`}
            className="gallery-masonry"
            items={uniquePhotos}
            render={GalleryCard}
            itemKey={photoUid}
            columnWidth={desktop ? 250 : 150}
            maxColumnCount={8}
            columnGutter={4}
            rowGutter={4}
            itemHeightEstimate={400}
            onRender={onRender}
          />
        </div>
      </GalleryNavigationContext>
      {query.isFetchNextPageError ? (
        <div role="alert" className="flex flex-col items-center gap-3 py-6">
          <p className="text-sm text-muted-foreground">{t("gallery.load-error")}</p>
          <Button variant="outline" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
            {t("gallery.retry")}
          </Button>
        </div>
      ) : query.isFetchingNextPage ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          {t("resource.fetching-data")}
        </div>
      ) : !query.hasNextPage && uniquePhotos.length > 0 ? (
        <div role="status" className="py-6 text-center text-xs text-muted-foreground">
          {t("gallery.end-of-gallery")}
        </div>
      ) : null}
    </div>
  );
}
