import { create } from "@bufbuild/protobuf";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GalleryPhotoInspector from "@/components/Gallery/GalleryPhotoInspector";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { PreviewMediaItem } from "@/utils/media-item";

vi.mock("@/hooks/useMediaQuery", () => ({ __esModule: true, default: () => true }));
vi.mock("@/hooks/usePhotoAnalysis", () => ({
  usePhotoAnalysis: () => ({
    isError: false,
    data: {
      palette: ["#123456"],
      histogram: {
        red: Array(256).fill(0),
        green: Array(256).fill(0),
        blue: Array(256).fill(0),
        luminance: Array(256).fill(0),
      },
      toneAnalysis: { toneType: "high-contrast", brightness: 48, contrast: 71, shadowRatio: 0.42, highlightRatio: 0.37 },
    },
  }),
}));
vi.mock("@/components/map/LazyLocationPicker", () => ({ LazyLocationPicker: () => null }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));

const attachment = create(AttachmentSchema, {
  name: "attachments/photo-1",
  filename: "photo.jpg",
  type: "image/jpeg",
  size: 400_000n,
});

const item: PreviewMediaItem = {
  id: attachment.name,
  kind: "image",
  filename: attachment.filename,
  sourceUrl: "/file/photo-1/photo.jpg",
  posterUrl: "/file/photo-1/photo.jpg?thumbnail=true",
  attachments: [attachment],
};

describe("GalleryPhotoInspector", () => {
  it("shows Lifemory's tone and histogram sections in the shared panel", () => {
    render(<GalleryPhotoInspector id="inspector" item={item} onClose={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "gallery.inspector-title" })).toBeInTheDocument();
    expect(screen.getByText("gallery.tone-high-contrast")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "gallery.histogram-description" })).toBeInTheDocument();
    expect(screen.queryByText("#123456")).not.toBeInTheDocument();
  });
});
