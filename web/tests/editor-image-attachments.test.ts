import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { memoService } from "@/components/MemoEditor/services/memoService";
import { toAttachmentItems } from "@/components/MemoEditor/types/attachment";
import { normalizeImageAttachments } from "@/components/MemoEditor/utils/imageAttachments";
import { AttachmentSchema, MotionMediaFamily, MotionMediaRole, MotionMediaSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema } from "@/types/proto/api/v1/memo_service_pb";

const first = create(AttachmentSchema, { name: "attachments/one", filename: "one.png", type: "image/png" });
const second = create(AttachmentSchema, { name: "attachments/two", filename: "two.png", type: "image/png" });

describe("image attachment edit initialization", () => {
  it("restores images from Markdown in their displayed order without losing prose or external images", () => {
    const result = normalizeImageAttachments(
      "A walk\n\n![two](/file/attachments/two)\n\n![one](/file/attachments/one)\n\n![other](https://example.com/image.png)",
      [first, second],
    );
    expect(result.attachments).toEqual([second, first]);
    expect(result.content).toContain("A walk");
    expect(result.content).toContain("![other](https://example.com/image.png)");
    expect(result.content).not.toContain("/file/attachments/");
  });
  it("preserves a saved gallery's order and filenames when reopening", () => {
    const renamed = create(AttachmentSchema, { ...second, filename: "Sunrise.png" });
    const memo = create(MemoSchema, { content: "A walk", attachments: [renamed, first] });
    const state = memoService.fromMemo(memo);
    expect(state.content).toBe(memo.content);
    expect(state.metadata.attachments).toEqual([renamed, first]);
  });
  it("does not erase references whose attachment bindings are missing", () => {
    expect(normalizeImageAttachments("![missing](/file/attachments/missing)", [first]).content).toBe(
      "![missing](/file/attachments/missing)",
    );
  });
  it("preserves significant indentation around text while extracting image references", () => {
    expect(normalizeImageAttachments("    const photo = true;\n\n![one](/file/attachments/one)", [first]).content).toBe(
      "    const photo = true;",
    );
  });
  it("preserves local Live Photo order among ordinary photos", () => {
    const photo = { file: new File(["photo"], "first.png", { type: "image/png" }), previewUrl: "blob:first" };
    const still = {
      file: new File(["photo"], "live.jpg", { type: "image/jpeg" }),
      previewUrl: "blob:live",
      motionMedia: create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.STILL, groupId: "live" }),
    };
    const video = {
      file: new File(["video"], "live.mov", { type: "video/quicktime" }),
      previewUrl: "blob:motion",
      motionMedia: create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.VIDEO, groupId: "live" }),
    };
    expect(toAttachmentItems([], [photo, still, video]).map((item) => item.id)).toEqual(["blob:first", "live"]);
  });
});
