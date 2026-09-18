import { getRequestToken, refreshAccessToken } from "@/connect";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentThumbnailUrl, getAttachmentUrl } from "@/utils/attachment";

export function getSocialShareUrl(platform: "x" | "telegram", shareUrl: string, title: string): string {
  const url = new URL(platform === "x" ? "https://x.com/intent/tweet" : "https://t.me/share/url");
  url.searchParams.set("url", shareUrl);
  url.searchParams.set("text", title);
  return url.toString();
}

export async function fetchGalleryShareFile(attachment: Attachment, signal?: AbortSignal): Promise<File> {
  const source = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(attachment.type)
    ? getAttachmentUrl(attachment)
    : getAttachmentThumbnailUrl(attachment);
  const local = new URL(source, window.location.origin).origin === window.location.origin;
  const send = async () => {
    const token = local ? await getRequestToken() : undefined;
    return fetch(source, {
      signal,
      credentials: local ? "same-origin" : "omit",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  };
  let response = await send();
  if (local && response.status === 401 && !signal?.aborted) {
    await refreshAccessToken();
    response = await send();
  }
  if (!response.ok) throw new Error(`Unable to prepare image (${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) throw new Error("The response is not an image");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[
    blob.type
  ];
  const filename = extension ? `${attachment.filename.replace(/\.[^.]+$/, "")}.${extension}` : attachment.filename;
  return new File([blob], filename, { type: blob.type });
}

export function downloadGalleryShareFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the object URL alive until the browser has started the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
