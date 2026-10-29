import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryInfiniteLoading } from "@/hooks/useGalleryInfiniteLoading";

const fetchNextPage = vi.fn();
const options = {
  resetKey: "ALL",
  nextPageToken: "page2",
  itemCount: 40,
  hasNextPage: true,
  isFetching: false,
  isError: false,
  fetchNextPage,
};
let sentinel: HTMLDivElement;
let top: number;
let intersect: () => void;
const useLoader = (props: typeof options) => {
  const ref = useGalleryInfiniteLoading(props);
  ref.current = sentinel;
  return ref;
};
beforeEach(() => {
  fetchNextPage.mockResolvedValue(undefined);
  sentinel = document.createElement("div");
  top = 2000;
  intersect = () => {};
  vi.spyOn(sentinel, "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 1 }) as DOMRect);
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: () => void) {
        intersect = callback;
      }
      observe() {
        intersect();
      }
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("gallery automatic pagination", () => {
  it("waits for the actual viewport and requests each page once", () => {
    const { rerender } = renderHook(useLoader, { initialProps: options });
    act(() => intersect());
    expect(fetchNextPage).not.toHaveBeenCalled();
    top = 300;
    act(() => intersect());
    expect(fetchNextPage).toHaveBeenCalledOnce();
    act(() => intersect());
    rerender({ ...options, isFetching: true });
    rerender(options);
    expect(fetchNextPage).toHaveBeenCalledOnce();
    top = 2000;
    rerender({ ...options, itemCount: 80, nextPageToken: "page3" });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    top = 300;
    act(() => intersect());
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    rerender({ ...options, itemCount: 80 });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("continues through empty pages until the server ends pagination", () => {
    top = 300;
    const { rerender } = renderHook(useLoader, { initialProps: { ...options, itemCount: 0 } });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    rerender({ ...options, itemCount: 0, nextPageToken: "page3" });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    rerender({ ...options, itemCount: 0, nextPageToken: "", hasNextPage: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("stops on error, during requests, and at the last page", () => {
    top = 300;
    const { rerender } = renderHook(useLoader, { initialProps: { ...options, isError: true } });
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender({ ...options, isFetching: true });
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender({ ...options, hasNextPage: false });
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender(options);
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("checks the new gallery position after changing filters", () => {
    top = 300;
    const { rerender } = renderHook(useLoader, { initialProps: options });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    top = 2000;
    rerender({ ...options, resetKey: "PRIVATE" });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    top = 300;
    act(() => intersect());
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });
});
