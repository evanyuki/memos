import { create, toJson } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRequestToken, refreshAccessToken } from "@/connect";
import { decodeGalleryPhoto, fetchGallery, readGalleryFilters, useGalleryPhoto, useGalleryPhotos } from "@/hooks/useGalleryQueries";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

vi.mock("@/connect", () => ({ getRequestToken: vi.fn(), refreshAccessToken: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ currentUser: { name: "users/owner" }, isInitialized: true }) }));
const photoJSON = () => ({
  attachment: toJson(
    AttachmentSchema,
    create(AttachmentSchema, { name: "attachments/photo", filename: "photo.jpg", type: "image/jpeg", size: 123n }),
  ),
  memo: toJson(MemoSchema, create(MemoSchema, { name: "memos/note", tags: ["travel"], visibility: Visibility.PRIVATE })),
});
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.mocked(getRequestToken).mockResolvedValue("session-token");
});

describe("gallery data access", () => {
  it("decodes protobuf JSON enums and bigint sizes", () => {
    const photo = decodeGalleryPhoto(photoJSON());
    expect(photo.attachment.size).toBe(123n);
    expect(photo.memo.visibility).toBe(Visibility.PRIVATE);
  });
  it("keeps protected separate and ignores unsupported URL filters", () => {
    expect(readGalleryFilters(new URLSearchParams("visibility=PROTECTED&tag=a%2Fb&state=ARCHIVED"))).toEqual({
      visibility: "PROTECTED",
      tag: "a/b",
      state: "ARCHIVED",
    });
    expect(readGalleryFilters(new URLSearchParams("visibility=bad&state=bad"))).toEqual({ visibility: "ALL", tag: "", state: "NORMAL" });
  });
  it("sends the existing session with no-store and retries one unauthorized response using existing refresh", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ photos: [] }));
    vi.mocked(refreshAccessToken).mockResolvedValue();
    const signal = new AbortController().signal;
    await fetchGallery("/api/v1/gallery/photos", signal);
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/gallery/photos",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        signal,
        headers: { Authorization: "Bearer session-token" },
      }),
    );
  });
  it("continues after an empty memo page and retains all photos from the next page", async () => {
    const request = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ photos: [], nextPageToken: "next-token" }))
      .mockResolvedValueOnce(Response.json({ photos: [photoJSON()], nextPageToken: "" }));
    const { result } = renderHook(() => useGalleryPhotos({ visibility: "PRIVATE", tag: "杭州/旅行", state: "NORMAL" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);
    await act(async () => {
      await result.current.fetchNextPage();
    });
    await waitFor(() => expect(result.current.data?.pages[1]?.photos[0].attachment.name).toBe("attachments/photo"));
    expect(result.current.hasNextPage).toBe(false);
    const url = new URL(String(request.mock.calls[1][0]), "https://memos.test");
    expect(url.searchParams.get("pageToken")).toBe("next-token");
    expect(url.searchParams.get("tag")).toBe("杭州/旅行");
  });
  it("cancels detail reads when the viewer unmounts, including share token reads", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const { unmount } = renderHook(() => useGalleryPhoto("photo", "token"), { wrapper });
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
