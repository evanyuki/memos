import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { getGalleryAttachments } from "@/components/Gallery/gallery-media";
import { withShareAttachmentLinks } from "@/hooks/useMemoShareQueries";
import { AttachmentSchema, MotionMediaFamily, MotionMediaRole } from "@/types/proto/api/v1/attachment_service_pb";
import { buildAttachmentVisualItems } from "@/utils/media-item";

const attachment = (uid: string, type: string) => create(AttachmentSchema, { name: `attachments/${uid}`, filename: `${uid}.file`, type });

describe("gallery photo navigation", () => {
  it("excludes PDF, audio, ordinary video and external images while keeping a Live Photo companion", () => {
    const still = attachment("still", "image/heic");
    still.motionMedia = {
      $typeName: "memos.api.v1.MotionMedia",
      family: MotionMediaFamily.APPLE_LIVE_PHOTO,
      role: MotionMediaRole.STILL,
      groupId: "pair",
      hasEmbeddedVideo: false,
    };
    const video = attachment("live-video", "video/quicktime");
    video.motionMedia = { ...still.motionMedia, role: MotionMediaRole.VIDEO };
    const external = { ...attachment("external", "image/jpeg"), externalLink: "https://example.test/photo.jpg" };
    const mixed = [
      attachment("photo", "image/jpeg"),
      attachment("document", "application/pdf"),
      attachment("sound", "audio/mpeg"),
      attachment("clip", "video/mp4"),
      external,
      still,
      video,
    ];
    const gallery = getGalleryAttachments(mixed);
    expect(gallery.map((item) => item.name)).toEqual(["attachments/photo", "attachments/still", "attachments/live-video"]);
    const items = buildAttachmentVisualItems(gallery);
    expect(items.map((item) => item.kind)).toEqual(["image", "motion"]);
    expect(items[1].attachmentNames).toEqual(["attachments/still", "attachments/live-video"]);
    const shared = buildAttachmentVisualItems(withShareAttachmentLinks(gallery, "token"));
    expect(shared).toHaveLength(2);
    expect(shared[0].sourceUrl).toContain("share_token=token");
    expect(shared[1].previewItem.kind).toBe("motion");
  });

  it("never admits a remote URL carrying a lookalike share token", () => {
    expect(
      getGalleryAttachments([{ ...attachment("remote", "image/png"), externalLink: "https://example.test/photo.png?share_token=token" }]),
    ).toEqual([]);
  });
});
