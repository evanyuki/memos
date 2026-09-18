import { cn } from "@/lib/utils";
import type { AttachmentVisualItem } from "@/utils/media-item";

export type VisualGalleryCell = {
  item: AttachmentVisualItem;
  className?: string;
  overlayLabel?: string;
};

/** Resolved layout for attachment visual previews — keeps grid rules in one place. */
export type VisualGalleryLayout =
  | { mode: "single"; item: AttachmentVisualItem }
  | { mode: "collage"; containerClassName: string; cells: VisualGalleryCell[] };

/** Show a complete nine-photo grid before revealing the remaining images in the viewer. */
export const COLLAGE_MAX_VISIBLE_CELLS = 9;

/**
 * Keep every thumbnail square and in attachment order; two/four photos use two columns.
 */
export const resolveVisualGalleryLayout = (items: AttachmentVisualItem[]): VisualGalleryLayout | null => {
  const count = items.length;

  if (count === 0) {
    return null;
  }

  if (count === 1) {
    return { mode: "single", item: items[0] };
  }

  const visible = items.slice(0, COLLAGE_MAX_VISIBLE_CELLS);
  const overflowCount = items.length - visible.length;

  return {
    mode: "collage",
    containerClassName: cn("grid w-full max-w-[36rem] gap-1.5 sm:gap-2", count === 2 || count === 4 ? "grid-cols-2" : "grid-cols-3"),
    cells: visible.map((item, index) => ({
      item,
      className: "aspect-square min-w-0",
      overlayLabel: index === visible.length - 1 && overflowCount > 0 ? `+${overflowCount}` : undefined,
    })),
  };
};
