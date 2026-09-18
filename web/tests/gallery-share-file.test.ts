import { create } from "@bufbuild/protobuf";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGalleryShareFile, getSocialShareUrl } from "@/components/Gallery/gallery-share";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

const { token, refresh, fetchMock } = vi.hoisted(() => ({ token: vi.fn(), refresh: vi.fn(), fetchMock: vi.fn() }));
vi.mock("@/connect", () => ({ getRequestToken: token, refreshAccessToken: refresh }));
const attachment = create(AttachmentSchema, { name: "attachments/photo", filename: "Sun & moon.png", type: "image/png" });

beforeEach(() => {
  token.mockResolvedValue("access-token");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(["image"], { type: "image/png" })) });
});

describe("gallery share files", () => {
  it("fetches private images with authentication and retains their real image type", async () => {
    const file = await fetchGalleryShareFile(attachment);
    expect(fetchMock).toHaveBeenCalledWith(
      `${window.location.origin}/file/attachments/photo/Sun%20%26%20moon.png`,
      expect.objectContaining({ credentials: "same-origin", headers: { Authorization: "Bearer access-token" } }),
    );
    expect(file.type).toBe("image/png");
    expect(file.name).toBe("Sun & moon.png");
  });

  it("never sends local access tokens or cookies to external image hosts", async () => {
    await fetchGalleryShareFile({ ...attachment, externalLink: "https://photos.example/image.png" });
    expect(token).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://photos.example/image.png",
      expect.objectContaining({ credentials: "omit", headers: {} }),
    );
  });

  it("refreshes an expired local session before retrying the image", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });
    await fetchGalleryShareFile(attachment);
    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses a browser-compatible thumbnail for HEIC and assigns the actual extension", async () => {
    const file = await fetchGalleryShareFile({ ...attachment, filename: "Sun.heic", type: "image/heic" });
    expect(fetchMock.mock.calls[0][0]).toContain("Sun.heic?thumbnail=true");
    expect(file.name).toBe("Sun.png");
  });

  it("rejects an HTML error response instead of sharing it as an image", async () => {
    fetchMock.mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["Sign in"], { type: "text/html" })) });
    await expect(fetchGalleryShareFile(attachment)).rejects.toThrow("not an image");
  });

  it("encodes links and photo titles without truncating non-Latin text or query strings", () => {
    const shareUrl = "https://memos.example/gallery/photos/photo?share_token=a&other=b";
    const url = new URL(getSocialShareUrl("x", shareUrl, "月亮 & Sun #photo"));
    expect(url.searchParams.get("url")).toBe(shareUrl);
    expect(url.searchParams.get("text")).toBe("月亮 & Sun #photo");
  });
});
