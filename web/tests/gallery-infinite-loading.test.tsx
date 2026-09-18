import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
beforeEach(() => fetchNextPage.mockResolvedValue(undefined));

describe("gallery automatic pagination", () => {
  it("loads near the rendered end once, without remounting the masonry or duplicating requests", () => {
    const { result, rerender } = renderHook(useGalleryInfiniteLoading, { initialProps: options });
    act(() => result.current(0, 10));
    expect(fetchNextPage).not.toHaveBeenCalled();
    act(() => result.current(20, 30));
    expect(fetchNextPage).toHaveBeenCalledOnce();
    act(() => result.current(20, 39));
    rerender({ ...options, isFetching: true });
    rerender(options);
    expect(fetchNextPage).toHaveBeenCalledOnce();
    rerender({ ...options, itemCount: 80, nextPageToken: "page3" });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    act(() => result.current(50, 70));
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("continues through empty pages until the server ends pagination", () => {
    const { rerender } = renderHook(useGalleryInfiniteLoading, { initialProps: { ...options, itemCount: 0 } });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    rerender({ ...options, itemCount: 0, nextPageToken: "page3" });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
    rerender({ ...options, itemCount: 0, nextPageToken: "", hasNextPage: false });
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });

  it("stops on error, during requests, and at the last page", () => {
    const { result, rerender } = renderHook(useGalleryInfiniteLoading, { initialProps: { ...options, isError: true } });
    act(() => result.current(20, 39));
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender({ ...options, isFetching: true });
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender({ ...options, hasNextPage: false });
    expect(fetchNextPage).not.toHaveBeenCalled();
    rerender(options);
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it("waits for a new rendered range after changing filters", () => {
    const { result, rerender } = renderHook(useGalleryInfiniteLoading, { initialProps: options });
    act(() => result.current(20, 39));
    rerender({ ...options, resetKey: "PRIVATE" });
    expect(fetchNextPage).toHaveBeenCalledOnce();
    act(() => result.current(20, 39));
    expect(fetchNextPage).toHaveBeenCalledTimes(2);
  });
});
