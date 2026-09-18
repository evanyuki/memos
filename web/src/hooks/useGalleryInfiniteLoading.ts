import { useCallback, useEffect, useRef, useState } from "react";

interface GalleryInfiniteLoadingOptions {
  resetKey: string;
  nextPageToken: string;
  itemCount: number;
  hasNextPage: boolean;
  isFetching: boolean;
  isError: boolean;
  fetchNextPage: () => Promise<unknown>;
}

/** Load ahead of the rendered masonry range, including pages without photos. */
export function useGalleryInfiniteLoading({
  resetKey,
  nextPageToken,
  itemCount,
  hasNextPage,
  isFetching,
  isError,
  fetchNextPage,
}: GalleryInfiniteLoadingOptions) {
  const [range, setRange] = useState({ resetKey, stopIndex: -1 });
  const requestedPage = useRef<string | undefined>(undefined);
  const pageKey = `${resetKey}:${nextPageToken}`;
  const onRender = useCallback(
    (_startIndex: number, stopIndex: number) => {
      setRange((previous) => (previous.resetKey === resetKey && previous.stopIndex === stopIndex ? previous : { resetKey, stopIndex }));
    },
    [resetKey],
  );

  useEffect(() => {
    const nearEnd = itemCount === 0 || (range.resetKey === resetKey && range.stopIndex >= Math.max(0, itemCount - 12));
    if (!nearEnd || !hasNextPage || isFetching || isError || requestedPage.current === pageKey) return;
    requestedPage.current = pageKey;
    void fetchNextPage().catch(() => {
      // React Query owns the error state; the grid offers an explicit retry.
    });
  }, [fetchNextPage, hasNextPage, isError, isFetching, itemCount, pageKey, range, resetKey]);

  return onRender;
}
