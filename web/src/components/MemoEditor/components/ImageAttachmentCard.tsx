import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, GripVerticalIcon, LoaderIcon, PencilIcon, XIcon } from "lucide-react";
import { type DragEventHandler, type PointerEventHandler, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import type { AttachmentItem } from "../types/attachment";
import { isValidImageFilename } from "../utils/imageAttachments";

interface Props {
  item: AttachmentItem;
  index: number;
  disabled: boolean;
  uploading: boolean;
  dragging: boolean;
  dropTarget: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onRename: (filename: string) => Promise<void>;
  onDragStart: DragEventHandler;
  onDragOver: DragEventHandler;
  onDrop: DragEventHandler;
  onDragEnd: DragEventHandler;
  onPointerDown: PointerEventHandler;
  onPointerMove: PointerEventHandler;
  onPointerUp: PointerEventHandler;
  onPointerCancel: PointerEventHandler;
}

export function ImageAttachmentCard({ item, index, disabled, uploading, dragging, dropTarget, ...actions }: Props) {
  const t = useTranslate();
  const [renaming, setRenaming] = useState(false);
  const [filename, setFilename] = useState(item.filename);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const busy = disabled || saving;

  const saveName = async () => {
    const next = filename.trim();
    if (!isValidImageFilename(next)) {
      setError(t("editor.images.invalid-name"));
      return;
    }
    if (next === item.filename) {
      setRenaming(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await actions.onRename(next);
      setRenaming(false);
    } catch {
      setError(t("editor.images.rename-failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      data-image-id={item.id}
      className={cn(
        "min-w-0 rounded-lg border border-border bg-card overflow-hidden",
        dragging && "opacity-50",
        dropTarget && "ring-2 ring-primary",
      )}
      onDragOver={actions.onDragOver}
      onDrop={actions.onDrop}
      aria-busy={uploading || saving || undefined}
    >
      <div className="relative aspect-square bg-muted/40">
        <button
          type="button"
          onClick={actions.onPreview}
          className="size-full focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          aria-label={t("editor.images.preview", { name: item.filename })}
        >
          <img src={item.thumbnailUrl} alt={item.filename} className="size-full object-cover" draggable={false} decoding="async" />
        </button>
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-xs tabular-nums text-white">
          {index + 1}
          {item.category === "motion" ? " · Live" : ""}
        </span>
        <button
          type="button"
          draggable={!busy}
          disabled={busy}
          onDragStart={actions.onDragStart}
          onDragEnd={actions.onDragEnd}
          onPointerDown={actions.onPointerDown}
          onPointerMove={actions.onPointerMove}
          onPointerUp={actions.onPointerUp}
          onPointerCancel={actions.onPointerCancel}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" && actions.canMoveEarlier) {
              event.preventDefault();
              actions.onMove(-1);
            }
            if (event.key === "ArrowRight" && actions.canMoveLater) {
              event.preventDefault();
              actions.onMove(1);
            }
          }}
          aria-label={t("editor.images.drag", { name: item.filename })}
          title={t("editor.images.drag", { name: item.filename })}
          className="absolute top-1 left-1 flex size-8 touch-none cursor-grab items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing disabled:opacity-40"
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={actions.onRemove}
          aria-label={t("editor.images.remove")}
          className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-md bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <XIcon className="size-4" />
        </button>
        {uploading && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/70 px-1 py-2 text-xs text-white"
          >
            <LoaderIcon className="size-3 animate-spin" />
            {t("editor.images.uploading")}
          </div>
        )}
      </div>
      <div className="p-1.5">
        {renaming ? (
          <div className="space-y-1">
            <Input
              autoFocus
              aria-label={t("editor.images.name")}
              aria-invalid={!!error}
              disabled={saving}
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveName();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setRenaming(false);
                }
              }}
              className="h-8 px-1.5 text-xs"
            />
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="icon-sm" disabled={saving} onClick={() => setRenaming(false)} aria-label={t("common.cancel")}>
                <XIcon className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={saving} onClick={() => void saveName()} aria-label={t("common.save")}>
                {saving ? <LoaderIcon className="size-3.5 animate-spin" /> : <CheckIcon className="size-3.5" />}
              </Button>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              title={item.filename}
              aria-label={`${t("editor.images.rename")}: ${item.filename}`}
              onClick={() => {
                setFilename(item.filename);
                setError("");
                setRenaming(true);
              }}
              className="flex h-8 w-full min-w-0 items-center gap-1 rounded px-1 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
            >
              <span className="flex-1 truncate">{item.filename}</span>
              <PencilIcon className="size-3 shrink-0 text-muted-foreground" />
            </button>
            <div className="flex justify-end gap-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy || !actions.canMoveEarlier}
                onClick={() => actions.onMove(-1)}
                aria-label={t("editor.images.move-earlier")}
              >
                <ArrowLeftIcon className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={busy || !actions.canMoveLater}
                onClick={() => actions.onMove(1)}
                aria-label={t("editor.images.move-later")}
              >
                <ArrowRightIcon className="size-3.5" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
