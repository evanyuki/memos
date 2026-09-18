import type { Element } from "hast";
import { useMemo } from "react";
import { VisualGallery } from "@/components/MemoMetadata/Attachment/AttachmentListView";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { type PreviewMediaItem, resolveImageVisualItem } from "@/utils/media-item";

export default function MarkdownImageGallery({
  node,
  attachments,
  onImagePreview,
}: {
  node: Element;
  attachments: Attachment[];
  onImagePreview?: (items: PreviewMediaItem[], index: number) => void;
}) {
  const items = useMemo(
    () =>
      node.children.flatMap((child) =>
        child.type === "element" && typeof child.properties.src === "string"
          ? [resolveImageVisualItem(child.properties.src, String(child.properties.alt ?? ""), attachments)]
          : [],
      ),
    [node, attachments],
  );

  return (
    <div className="my-2" data-memo-image-gallery>
      <VisualGallery
        items={items}
        onPreview={
          onImagePreview
            ? (id) =>
                onImagePreview(
                  items.map((item) => item.previewItem),
                  Math.max(
                    0,
                    items.findIndex((item) => item.id === id),
                  ),
                )
            : undefined
        }
      />
    </div>
  );
}
