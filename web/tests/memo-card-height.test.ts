import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import { estimateMemoCardHeight } from "@/components/PagedMemoList/memoCardHeight";
import { type Attachment, AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import {
  type Memo,
  MemoRelation_MemoSchema,
  MemoRelation_Type,
  MemoRelationSchema,
  MemoSchema,
} from "@/types/proto/api/v1/memo_service_pb";

const buildAttachment = (overrides: Partial<Attachment>) =>
  create(AttachmentSchema, {
    name: "attachments/test",
    filename: "test.bin",
    type: "application/octet-stream",
    ...overrides,
  });

const buildCommentRelation = (memoName: string, index: number) =>
  create(MemoRelationSchema, {
    type: MemoRelation_Type.COMMENT,
    memo: create(MemoRelation_MemoSchema, { name: `memos/comment-${index}` }),
    relatedMemo: create(MemoRelation_MemoSchema, { name: memoName }),
  });

const buildMemo = (overrides: Partial<Memo> = {}) =>
  create(MemoSchema, {
    name: "memos/main",
    content: "hello",
    attachments: [],
    relations: [],
    ...overrides,
  });

describe("estimateMemoCardHeight", () => {
  it("accounts for visual attachments before images have loaded", () => {
    const plain = buildMemo();
    const withImage = buildMemo({
      attachments: [
        buildAttachment({
          name: "attachments/image",
          filename: "image.png",
          type: "image/png",
        }),
      ],
    });

    expect(estimateMemoCardHeight(withImage, { columnWidth: 320 })).toBeGreaterThan(
      estimateMemoCardHeight(plain, { columnWidth: 320 }) + 100,
    );
  });

  it("does not count an inline managed image again as an attachment gallery", () => {
    const image = buildAttachment({ name: "attachments/image", filename: "image.png", type: "image/png" });
    const inline = buildMemo({ content: "![image](/file/attachments/image)", attachments: [image] });
    const external = buildMemo({ content: "![image](https://example.com/image.png)", attachments: [image] });

    expect(estimateMemoCardHeight(inline, { columnWidth: 320 })).toBeLessThan(estimateMemoCardHeight(external, { columnWidth: 320 }));
  });

  it("estimates square grid rows at the available width and caps overflow at nine cells", () => {
    const withImages = (count: number) =>
      buildMemo({
        attachments: Array.from({ length: count }, (_, index) =>
          buildAttachment({ name: `attachments/image-${index}`, filename: `${index}.jpg`, type: "image/jpeg" }),
        ),
      });
    const height = (count: number, columnWidth = 320) => estimateMemoCardHeight(withImages(count), { columnWidth });
    expect(height(6)).toBeGreaterThan(height(3));
    expect(height(9)).toBeGreaterThan(height(6));
    expect(height(12)).toBe(height(9));
    expect(height(3, 240)).toBeLessThan(height(3, 320));
  });

  it("estimates the visible comment preview height and caps it at three comments", () => {
    const oneComment = buildMemo({ relations: [buildCommentRelation("memos/main", 1)] });
    const threeComments = buildMemo({
      relations: [1, 2, 3].map((index) => buildCommentRelation("memos/main", index)),
    });
    const fiveComments = buildMemo({
      relations: [1, 2, 3, 4, 5].map((index) => buildCommentRelation("memos/main", index)),
    });

    expect(estimateMemoCardHeight(threeComments, { columnWidth: 320 })).toBeGreaterThan(
      estimateMemoCardHeight(oneComment, { columnWidth: 320 }),
    );
    expect(estimateMemoCardHeight(fiveComments, { columnWidth: 320 })).toBe(estimateMemoCardHeight(threeComments, { columnWidth: 320 }));
  });
});
