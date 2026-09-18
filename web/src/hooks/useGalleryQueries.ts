import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { getRequestToken, refreshAccessToken } from "@/connect";
import { useAuth } from "@/contexts/AuthContext";
import { type Attachment, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { type Memo, MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

export interface GalleryPhoto {
  attachment: Attachment;
  memo: Memo;
}

export interface GalleryFilters {
  visibility: "ALL" | "PUBLIC" | "PRIVATE" | "PROTECTED";
  tag: string;
  state: "NORMAL" | "ARCHIVED";
}

export const galleryKeys = { all: ["gallery"] as const };

export class GalleryRequestError extends Error {
  constructor(public readonly status: number) {
    super(`Unable to load gallery (${status})`);
  }
}

export function decodeGalleryPhoto(value: { attachment: JsonValue; memo: JsonValue }): GalleryPhoto {
  return {
    attachment: fromJson(AttachmentSchema, value.attachment, { ignoreUnknownFields: true }),
    memo: fromJson(MemoSchema, value.memo, { ignoreUnknownFields: true }),
  };
}

export async function fetchGallery(path: string, signal?: AbortSignal): Promise<unknown> {
  const send = async () => {
    const token = await getRequestToken();
    return fetch(path, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let response = await send();
  if (response.status === 401 && !signal?.aborted) {
    await refreshAccessToken();
    response = await send();
  }
  if (!response.ok) throw new GalleryRequestError(response.status);
  return response.json();
}

export function readGalleryFilters(params: URLSearchParams): GalleryFilters {
  const visibility = params.get("visibility");
  return {
    visibility: visibility === "PUBLIC" || visibility === "PRIVATE" || visibility === "PROTECTED" ? visibility : "ALL",
    state: params.get("state") === "ARCHIVED" ? "ARCHIVED" : "NORMAL",
    tag: params.get("tag") ?? "",
  };
}

export function useGalleryPhotos(filters: GalleryFilters) {
  const { currentUser, isInitialized } = useAuth();
  return useInfiniteQuery({
    queryKey: [...galleryKeys.all, "list", currentUser?.name ?? "guest", filters],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ ...filters, pageToken: pageParam });
      const result = (await fetchGallery(`/api/v1/gallery/photos?${params}`, signal)) as {
        photos: Array<{ attachment: JsonValue; memo: JsonValue }>;
        nextPageToken?: string;
      };
      return { photos: result.photos.map(decodeGalleryPhoto), nextPageToken: result.nextPageToken ?? "" };
    },
    initialPageParam: "",
    getNextPageParam: (page) => page.nextPageToken || undefined,
    enabled: isInitialized,
    staleTime: 0,
    retry: false,
  });
}

export function useGalleryPhoto(uid: string, shareToken?: string) {
  const { currentUser, isInitialized } = useAuth();
  return useQuery({
    queryKey: [...galleryKeys.all, "photo", currentUser?.name ?? "guest", uid, shareToken ?? ""],
    queryFn: async ({ signal }) => {
      const query = shareToken ? `?${new URLSearchParams({ share_token: shareToken })}` : "";
      const value = (await fetchGallery(`/api/v1/gallery/photos/${encodeURIComponent(uid)}${query}`, signal)) as {
        attachment: JsonValue;
        memo: JsonValue;
      };
      return decodeGalleryPhoto(value);
    },
    enabled: isInitialized && !!uid,
    staleTime: 0,
    retry: false,
  });
}
