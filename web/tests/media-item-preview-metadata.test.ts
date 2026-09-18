import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { AttachmentSchema, MediaMetadataSchema, MotionMediaFamily, MotionMediaRole } from "@/types/proto/api/v1/attachment_service_pb";
import { buildAttachmentVisualItems, resolveImageVisualItem } from "@/utils/media-item";

describe("media preview metadata plumbing", () => {
  it("keeps the source attachment on preview items", () => {
    const attachment = create(AttachmentSchema, {
      name: "attachments/photo",
      filename: "photo.jpg",
      type: "image/jpeg",
      mediaMetadata: create(MediaMetadataSchema, { width: 1200, height: 800 }),
    });

    const [item] = buildAttachmentVisualItems([attachment]);

    expect(item.previewItem.attachments).toEqual([attachment]);
  });

  it("resolves a managed Markdown URL to a share URL without losing the attachment metadata", () => {
    const attachment = create(AttachmentSchema, {
      name: "attachments/photo",
      filename: "renamed.jpg",
      type: "image/jpeg",
      externalLink: "https://memos.example/file/attachments/photo?share_token=shared",
      mediaMetadata: { width: 1200, height: 800 },
    });
    const item = resolveImageVisualItem("/file/attachments/photo", "old-name", [attachment]);
    expect(item.sourceUrl).toBe(attachment.externalLink);
    expect(item.previewItem.attachments).toEqual([attachment]);
    expect(item.filename).toBe("renamed.jpg");
  });

  it("preserves both halves of a Live Photo when opening its inline still", () => {
    const still = create(AttachmentSchema, {
      name: "attachments/still",
      filename: "live.jpg",
      type: "image/jpeg",
      motionMedia: { groupId: "live", family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.STILL },
    });
    const video = create(AttachmentSchema, {
      name: "attachments/video",
      filename: "live.mov",
      type: "video/quicktime",
      motionMedia: { groupId: "live", family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.VIDEO },
    });
    const item = resolveImageVisualItem("/file/attachments/still", "live", [video, still]);
    expect(item.kind).toBe("motion");
    expect(item.previewItem.attachments).toEqual([still, video]);
  });

  it("does not invent metadata for an unrelated external image or fail on malformed URLs", () => {
    expect(resolveImageVisualItem("https://example.com/photo.jpg", "External", []).previewItem.attachments).toBeUndefined();
    expect(() => resolveImageVisualItem("http://", "Malformed", [])).not.toThrow();
  });
});
