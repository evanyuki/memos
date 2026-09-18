import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MemoMarkdownRenderer } from "@/components/MemoContent/MemoMarkdownRenderer";
import AttachmentListView from "@/components/MemoMetadata/Attachment/AttachmentListView";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { AttachmentSchema, MediaMetadataSchema, PhotoMetadataSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { PreviewMediaItem } from "@/utils/media-item";

vi.mock("@/hooks/useMediaQuery", () => ({ default: () => false }));
vi.mock("@/components/map/LazyLocationPicker", () => ({ LazyLocationPicker: () => null }));
vi.mock("@/utils/i18n", () => ({
  findNearestMatchedLanguage: (language: string) => language || "en",
  useTranslate: () => (key: string) => key,
}));

const images = Array.from({ length: 11 }, (_, index) =>
  create(AttachmentSchema, {
    name: `attachments/photo-${index + 1}`,
    filename: `photo-${index + 1}.jpg`,
    type: "image/jpeg",
    mediaMetadata: create(MediaMetadataSchema, {
      width: 2400,
      height: 1600,
      details: { case: "photo", value: create(PhotoMetadataSchema, { cameraModel: "X-T5", fNumber: 2.8, iso: 200 + index }) },
    }),
  }),
);

const markdown = images.map((image) => `![${image.filename}](/file/${image.name})`).join("\n\n");

describe("memo image galleries", () => {
  it("shows nine ordered square tiles and keeps overflow images available in the preview", () => {
    const onImagePreview = vi.fn();
    const { container } = render(<AttachmentListView attachments={images} onImagePreview={onImagePreview} />);
    const tiles = screen.getAllByRole("button");
    expect(tiles).toHaveLength(9);
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual(images.slice(0, 9).map((image) => image.filename));
    expect(container.querySelector(".grid-cols-3")).toBeInTheDocument();
    tiles.forEach((tile) => expect(tile).toHaveClass("aspect-square"));
    expect(screen.getByText("+2")).toBeInTheDocument();
    fireEvent.keyDown(tiles[8], { key: "Enter" });
    expect(onImagePreview).toHaveBeenCalledWith(
      images.map((image) => expect.objectContaining({ id: image.name, attachments: [image] })),
      8,
    );
  });

  it("groups legacy Markdown image paragraphs and line breaks into the same nine-photo grid", () => {
    const onImagePreview = vi.fn();
    const { container } = render(
      <MemoMarkdownRenderer
        content={markdown.replace("\n\n", "\n")}
        attachments={images}
        resolvedMentionUsernames={new Set()}
        onImagePreview={onImagePreview}
      />,
    );
    const gallery = container.querySelector("[data-memo-image-gallery]")!;
    expect(gallery).toBeInTheDocument();
    expect(within(gallery as HTMLElement).getAllByRole("img")).toHaveLength(9);
    fireEvent.click(screen.getByRole("button", { name: "photo-3.jpg" }));
    expect(onImagePreview).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ attachments: [images[2]] })]), 2);
  });

  it("preserves text between image groups and leaves linked images as links", () => {
    const { container } = render(
      <MemoMarkdownRenderer
        content={
          "![one](/one.jpg)\n![two](/two.jpg)\n\nCaption\n\n![three](/three.jpg)\n![four](/four.jpg)\n\n[![linked](/linked.jpg)](https://example.com)"
        }
        resolvedMentionUsernames={new Set()}
        onImagePreview={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-memo-image-gallery]")).toHaveLength(2);
    expect(screen.getByText("Caption").previousElementSibling).toHaveAttribute("data-memo-image-gallery");
    expect(screen.getByText("Caption").nextElementSibling).toHaveAttribute("data-memo-image-gallery");
    expect(screen.getByAltText("linked").closest("a")).toHaveAttribute("href", "https://example.com");
    expect(screen.getByAltText("linked").closest("button")).toBeNull();
  });

  it("preserves EXIF when opening and navigating a memo's inline images", () => {
    const Example = () => {
      const [preview, setPreview] = useState<{ items: PreviewMediaItem[]; index: number }>();
      return (
        <>
          <MemoMarkdownRenderer
            content={markdown}
            attachments={images}
            resolvedMentionUsernames={new Set()}
            onImagePreview={(items, index) => setPreview({ items, index })}
          />
          {preview && <PreviewImageDialog open onOpenChange={vi.fn()} items={preview.items} initialIndex={preview.index} />}
        </>
      );
    };
    render(<Example />);
    fireEvent.click(screen.getByRole("button", { name: "photo-3.jpg" }));
    fireEvent.click(screen.getByRole("button", { name: "attachment-details.actions.show" }));
    expect(screen.getByText("X-T5")).toBeInTheDocument();
    expect(screen.getByText("ƒ/2.8 · ISO 202")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next item" }));
    expect(screen.getByText("ƒ/2.8 · ISO 203")).toBeInTheDocument();
    expect(screen.queryByText("ƒ/2.8 · ISO 202")).not.toBeInTheDocument();
  });
});
