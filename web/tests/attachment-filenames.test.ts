import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { withShareAttachmentLinks } from "@/hooks/useMemoShareQueries";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentMotionClipUrl, getAttachmentThumbnailUrl, getAttachmentUrl } from "@/utils/attachment";

const filename = "杭州 #1 ? edit%20.jpg";
const attachment = create(AttachmentSchema, { name: "attachments/photo", filename, type: "image/jpeg" });

describe("reserved filename characters", () => {
  it("encodes the filename exactly once in original, thumbnail and motion URLs", () => {
    for (const build of [getAttachmentUrl, getAttachmentThumbnailUrl, getAttachmentMotionClipUrl]) {
      const url = new URL(build(attachment));
      expect(decodeURIComponent(url.pathname.split("/").pop()!)).toBe(filename);
      expect(url.hash).toBe("");
      expect(url.searchParams.has(" edit%20.jpg")).toBe(false);
    }
  });
  it("keeps private share grants and selectors out of the filename", () => {
    const shared = withShareAttachmentLinks([attachment], "token?#")[0];
    for (const build of [getAttachmentUrl, getAttachmentThumbnailUrl, getAttachmentMotionClipUrl]) {
      const url = new URL(build(shared));
      expect(decodeURIComponent(url.pathname.split("/").pop()!)).toBe(filename);
      expect(url.hash).toBe("");
      expect(url.searchParams.get("share_token")).toBe("token?#");
    }
    expect(new URL(getAttachmentThumbnailUrl(shared)).searchParams.get("thumbnail")).toBe("true");
    expect(new URL(getAttachmentMotionClipUrl(shared)).searchParams.get("motion")).toBe("true");
  });
});
