import { useEffect, useRef } from "react";

interface GalleryInfiniteLoadingOptions {
  resetKey: string;
  nextPageToken: string;
  itemCount: number;
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/** Load when the gallery's end approaches the viewport. */
export function useGalleryInfiniteLoading({
  resetKey,
  nextPageToken,
  itemCount,
  hasNextPage,
  isFetching,
  isError,
  fetchNextPage,
}: GalleryInfiniteLoadingOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestedPages = useRef({ resetKey, tokens: new Set<string>() });

  useEffect(() => {
    if (requestedPages.current.resetKey !== resetKey) {
      requestedPages.current = { resetKey, tokens: new Set() };
    }
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasNextPage || !nextPageToken || isFetching || isError) return;
    const loadNearViewport = () => {
      const bounds = sentinel.getBoundingClientRect();
      if (bounds.top > window.innerHeight + 400 || bounds.bottom < 0 || requestedPages.current.tokens.has(nextPageToken)) return;
      requestedPages.current.tokens.add(nextPageToken);
      void fetchNextPage().catch(() => {
        // React Query owns the error state; the grid offers an explicit retry.
      });
    };
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver(loadNearViewport, { rootMargin: "400px 0px" });
      observer.observe(sentinel);
      return () => observer.disconnect();
    }
    const frame = requestAnimationFrame(loadNearViewport);
    window.addEventListener("scroll", loadNearViewport, { passive: true });
    window.addEventListener("resize", loadNearViewport);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", loadNearViewport);
      window.removeEventListener("resize", loadNearViewport);
    };
  }, [fetchNextPage, hasNextPage, isError, isFetching, itemCount, nextPageToken, resetKey]);

  return sentinelRef;
}
