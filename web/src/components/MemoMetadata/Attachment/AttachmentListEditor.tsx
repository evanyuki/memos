import { ChevronDownIcon, ChevronUpIcon, FileAudioIcon, FileIcon, PaperclipIcon, PauseIcon, PlayIcon, XIcon } from "lucide-react";
import { type FC, type MouseEvent, useMemo, useRef, useState } from "react";
import { ImageAttachmentCard } from "@/components/MemoEditor/components/ImageAttachmentCard";
import type { AttachmentItem, LocalFile } from "@/components/MemoEditor/types/attachment";
import { getAudioRecordingTimeLabel, toAttachmentItems } from "@/components/MemoEditor/types/attachment";
import { moveAttachmentItem, renameLocalFile } from "@/components/MemoEditor/utils/imageAttachments";
import MetadataSection from "@/components/MemoMetadata/MetadataSection";
import PreviewImageDialog from "@/components/PreviewImageDialog";
import { Button } from "@/components/ui/button";
import { useUpdateAttachment } from "@/hooks/useAttachmentQueries";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { formatFileSize, getFileTypeLabel } from "@/utils/format";
import { useTranslate } from "@/utils/i18n";
import type { PreviewMediaItem } from "@/utils/media-item";
import { formatAudioTime, toggleAudioPlayback } from "./attachmentHelpers";

const collectMembers = <T,>(byId: ReadonlyMap<string, T>, memberIds: string[]): T[] =>
  memberIds.map((memberId) => byId.get(memberId)).filter((member): member is T => member !== undefined);

interface AttachmentListEditorProps {
  attachments: Attachment[];
  localFiles?: LocalFile[];
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  onLocalFilesChange?: (localFiles: LocalFile[]) => void;
  onRemoveLocalFile?: (previewUrl: string) => void;
  placementActionsDisabled?: boolean;
  uploadingLocalFileURLs?: ReadonlySet<string>;
  onRenamePendingChange?: (pending: boolean) => void;
}

const AttachmentItemActions: FC<{
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
}> = ({ onRemove, onMoveUp, onMoveDown, canMoveUp = true, canMoveDown = true }) => {
  const stopPropagation = (event: MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="shrink-0 flex items-center gap-0.5">
      {onMoveUp && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            stopPropagation(event);
            onMoveUp();
          }}
          disabled={!canMoveUp}
          title="Move up"
          aria-label="Move attachment up"
        >
          <ChevronUpIcon className="h-3 w-3 text-muted-foreground" />
        </Button>
      )}

      {onMoveDown && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            stopPropagation(event);
            onMoveDown();
          }}
          disabled={!canMoveDown}
          title="Move down"
          aria-label="Move attachment down"
        >
          <ChevronDownIcon className="h-3 w-3 text-muted-foreground" />
        </Button>
      )}

      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            stopPropagation(event);
            onRemove();
          }}
          title="Remove"
          aria-label="Remove attachment"
        >
          <XIcon className="h-3 w-3 text-muted-foreground hover:text-destructive" />
        </Button>
      )}
    </div>
  );
};

const AttachmentItemCard: FC<{
  item: AttachmentItem;
  onPreview?: () => void;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  isUploadingInline?: boolean;
}> = ({ item, onPreview, onRemove, onMoveUp, onMoveDown, canMoveUp = true, canMoveDown = true, isUploadingInline }) => {
  const t = useTranslate();
  const { category, filename, thumbnailUrl, mimeType, size, sourceUrl, isVoiceNote, audioMeta } = item;
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const fileTypeLabel = item.category === "motion" ? "Live Photo" : getFileTypeLabel(mimeType);
  const isPreviewable = category === "image" || category === "video" || category === "motion";
  const recordingTimeLabel = isVoiceNote ? getAudioRecordingTimeLabel(filename) : undefined;
  const titleLabel =
    isVoiceNote && recordingTimeLabel
      ? t("editor.audio-recorder.attachment-label-with-time", { time: recordingTimeLabel })
      : isVoiceNote
        ? t("editor.audio-recorder.attachment-label")
        : filename;
  const detailParts = [
    isUploadingInline ? t("editor.insert-menu.uploading-inline-image") : undefined,
    audioMeta?.durationSeconds ? formatAudioTime(audioMeta.durationSeconds) : undefined,
    fileTypeLabel,
    size ? formatFileSize(size) : undefined,
  ].filter(Boolean);

  const handleAudioToggle = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    await toggleAudioPlayback(audio, sourceUrl, () => setIsPlaying(false));
  };

  return (
    <div
      className="relative rounded border border-transparent px-1.5 py-1 transition-all hover:border-border hover:bg-accent/20"
      aria-busy={isUploadingInline || undefined}
    >
      <div className="flex items-center gap-1.5">
        <div className="relative flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded bg-muted/40">
          {(category === "image" || category === "motion") && thumbnailUrl ? (
            <div
              onClick={(event) => {
                event.stopPropagation();
                onPreview?.();
              }}
              className={cn("h-full w-full overflow-hidden", isPreviewable ? "cursor-pointer" : "cursor-default")}
              aria-label={`Preview ${filename}`}
            >
              <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
            </div>
          ) : isVoiceNote ? (
            <>
              <button
                type="button"
                onClick={handleAudioToggle}
                className="flex size-full items-center justify-center rounded bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={isPlaying ? t("editor.audio-recorder.pause-recording") : t("editor.audio-recorder.play-recording")}
              >
                {isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5 translate-x-[0.5px]" />}
              </button>
              <audio
                ref={audioRef}
                preload="none"
                className="hidden"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            </>
          ) : category === "video" ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPreview?.();
              }}
              className="flex size-full items-center justify-center rounded bg-muted/40 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={`Preview ${filename}`}
            >
              <PlayIcon className="h-3.5 w-3.5 translate-x-[0.5px]" />
            </button>
          ) : category === "audio" ? (
            <FileAudioIcon className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <FileIcon className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {category === "motion" && (
            <span className="absolute inset-x-0 bottom-0 bg-black/70 text-center text-[7px] font-semibold uppercase tracking-wide text-white">
              Live
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
          <span className="truncate text-xs" title={filename}>
            {titleLabel}
          </span>

          <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
            {detailParts.map((part, index) => (
              <span key={`${item.id}-${part}`}>
                {index > 0 && <span className="hidden text-muted-foreground/50 sm:inline"> • </span>}
                <span>{part}</span>
              </span>
            ))}
          </div>
        </div>

        <AttachmentItemActions
          onRemove={onRemove}
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
        />
      </div>
    </div>
  );
};

const AttachmentListEditor: FC<AttachmentListEditorProps> = ({
  attachments,
  localFiles = [],
  onAttachmentsChange,
  onLocalFilesChange,
  onRemoveLocalFile,
  placementActionsDisabled = false,
  uploadingLocalFileURLs = new Set(),
  onRenamePendingChange,
}) => {
  const t = useTranslate();
  const { mutateAsync: updateAttachment } = useUpdateAttachment();
  const [draggedID, setDraggedID] = useState<string>();
  const [dropTargetID, setDropTargetID] = useState<string>();
  const touchTargetRef = useRef<string | undefined>(undefined);
  const [previewState, setPreviewState] = useState<{ open: boolean; initialIndex: number }>({ open: false, initialIndex: 0 });
  const attachmentsByName = useMemo(() => new Map(attachments.map((attachment) => [attachment.name, attachment])), [attachments]);
  const items = toAttachmentItems(attachments, localFiles);
  const imageItems = items.filter((item) => item.category === "image" || item.category === "motion");
  const fileItems = items.filter((item) => item.category !== "image" && item.category !== "motion");
  const attachmentItems = items.filter((item) => !item.isLocal);
  const localItems = items.filter((item) => item.isLocal);
  const previewItems = useMemo<PreviewMediaItem[]>(
    () =>
      items.reduce<PreviewMediaItem[]>((acc, item) => {
        const itemAttachments = item.isLocal ? undefined : collectMembers(attachmentsByName, item.memberIds);
        if (item.category === "image") {
          acc.push({
            id: item.id,
            kind: "image",
            sourceUrl: item.sourceUrl,
            posterUrl: item.thumbnailUrl,
            filename: item.filename,
            attachments: itemAttachments,
          });
          return acc;
        }

        if (item.category === "video") {
          acc.push({
            id: item.id,
            kind: "video",
            sourceUrl: item.sourceUrl,
            posterUrl: item.thumbnailUrl,
            filename: item.filename,
            attachments: itemAttachments,
          });
          return acc;
        }

        if (item.category === "motion") {
          acc.push({
            id: item.id,
            kind: "motion",
            motionUrl: item.sourceUrl,
            posterUrl: item.thumbnailUrl,
            filename: item.filename,
            attachments: itemAttachments,
          });
          return acc;
        }

        return acc;
      }, []),
    [attachmentsByName, items],
  );

  // Items address their members by id, so index once instead of re-scanning both
  // source arrays for every item on every render.
  const localFilesByPreviewUrl = useMemo(() => new Map(localFiles.map((localFile) => [localFile.previewUrl, localFile])), [localFiles]);

  const handleMoveAttachments = (itemId: string, direction: -1 | 1) => {
    if (!onAttachmentsChange) return;

    const itemIndex = attachmentItems.findIndex((item) => item.id === itemId);
    const targetIndex = itemIndex + direction;
    if (itemIndex < 0 || targetIndex < 0 || targetIndex >= attachmentItems.length) {
      return;
    }

    const reorderedItems = [...attachmentItems];
    [reorderedItems[itemIndex], reorderedItems[targetIndex]] = [reorderedItems[targetIndex], reorderedItems[itemIndex]];

    onAttachmentsChange(reorderedItems.flatMap((item) => collectMembers(attachmentsByName, item.memberIds)));
  };

  const handleMoveLocalFiles = (itemId: string, direction: -1 | 1) => {
    if (!onLocalFilesChange) return;

    const itemIndex = localItems.findIndex((item) => item.id === itemId);
    const targetIndex = itemIndex + direction;
    if (itemIndex < 0 || targetIndex < 0 || targetIndex >= localItems.length) {
      return;
    }

    const reorderedItems = [...localItems];
    [reorderedItems[itemIndex], reorderedItems[targetIndex]] = [reorderedItems[targetIndex], reorderedItems[itemIndex]];

    onLocalFilesChange(reorderedItems.flatMap((item) => collectMembers(localFilesByPreviewUrl, item.memberIds)));
  };

  const handleRemoveItem = (item: AttachmentItem) => {
    if (item.isLocal) {
      const nextLocalFiles = localFiles.filter((file) => !item.memberIds.includes(file.previewUrl));
      onLocalFilesChange?.(nextLocalFiles);
      if (!onLocalFilesChange) {
        item.memberIds.forEach((previewUrl) => onRemoveLocalFile?.(previewUrl));
      }
      return;
    }

    if (onAttachmentsChange) {
      onAttachmentsChange(attachments.filter((attachment) => !item.memberIds.includes(attachment.name)));
    }
  };

  const handlePreviewItem = (item: AttachmentItem) => {
    const previewIndex = previewItems.findIndex((previewItem) => previewItem.id === item.id);
    if (previewIndex < 0) {
      return;
    }

    setPreviewState({ open: true, initialIndex: previewIndex });
  };

  const resetDrag = () => {
    setDraggedID(undefined);
    setDropTargetID(undefined);
    touchTargetRef.current = undefined;
  };
  const moveImage = (sourceID: string, targetID: string) => {
    const source = items.find((item) => item.id === sourceID);
    const target = items.find((item) => item.id === targetID);
    if (!source || !target || source.isLocal !== target.isLocal || placementActionsDisabled) return;
    if (source.isLocal) {
      onLocalFilesChange?.(
        moveAttachmentItem(localItems, sourceID, targetID).flatMap((item) => collectMembers(localFilesByPreviewUrl, item.memberIds)),
      );
    } else {
      onAttachmentsChange?.(
        moveAttachmentItem(attachmentItems, sourceID, targetID).flatMap((item) => collectMembers(attachmentsByName, item.memberIds)),
      );
    }
  };
  const renameImage = async (item: AttachmentItem, filename: string) => {
    if (item.isLocal) {
      const still = item.memberIds.find((id) => localFilesByPreviewUrl.get(id)?.file.type.startsWith("image/"));
      onLocalFilesChange?.(localFiles.map((file) => (file.previewUrl === still ? renameLocalFile(file, filename) : file)));
    } else {
      const still = collectMembers(attachmentsByName, item.memberIds).find((attachment) => attachment.type.startsWith("image/"));
      if (!still) return;
      onRenamePendingChange?.(true);
      try {
        const updated = await updateAttachment({ name: still.name, filename });
        onAttachmentsChange?.(attachments.map((attachment) => (attachment.name === updated.name ? updated : attachment)));
      } finally {
        onRenamePendingChange?.(false);
      }
    }
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {imageItems.length > 0 && (
        <section aria-label={t("editor.images.title")} className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {imageItems.map((item, index) => {
              const siblings = imageItems.filter((candidate) => candidate.isLocal === item.isLocal);
              const siblingIndex = siblings.findIndex((candidate) => candidate.id === item.id);
              const uploading = item.isLocal && item.memberIds.some((id) => uploadingLocalFileURLs.has(id));
              return (
                <ImageAttachmentCard
                  key={item.id}
                  item={item}
                  index={index}
                  uploading={uploading}
                  disabled={placementActionsDisabled || uploading}
                  dragging={draggedID === item.id}
                  dropTarget={dropTargetID === item.id && draggedID !== item.id}
                  canMoveEarlier={siblingIndex > 0}
                  canMoveLater={siblingIndex < siblings.length - 1}
                  onPreview={() => handlePreviewItem(item)}
                  onRemove={() => handleRemoveItem(item)}
                  onRename={(filename) => renameImage(item, filename)}
                  onMove={(direction) => {
                    const target = siblings[siblingIndex + direction];
                    if (target) moveImage(item.id, target.id);
                  }}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", item.id);
                    event.dataTransfer.effectAllowed = "move";
                    setDraggedID(item.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedID || placementActionsDisabled) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTargetID(item.id);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    if (draggedID) moveImage(draggedID, item.id);
                    resetDrag();
                  }}
                  onDragEnd={resetDrag}
                  onPointerDown={(event) => {
                    if (event.pointerType !== "touch") return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setDraggedID(item.id);
                  }}
                  onPointerMove={(event) => {
                    if (event.pointerType !== "touch" || !draggedID) return;
                    const targetID = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-image-id]")
                      ?.dataset.imageId;
                    touchTargetRef.current = targetID;
                    setDropTargetID(targetID);
                  }}
                  onPointerUp={(event) => {
                    if (event.pointerType !== "touch") return;
                    if (touchTargetRef.current) moveImage(item.id, touchTargetRef.current);
                    resetDrag();
                  }}
                  onPointerCancel={resetDrag}
                />
              );
            })}
          </div>
          {imageItems.length > 1 && <p className="text-xs text-muted-foreground">{t("editor.images.reorder-hint")}</p>}
        </section>
      )}
      {fileItems.length > 0 && (
        <MetadataSection
          icon={PaperclipIcon}
          title={t("common.attachments")}
          count={fileItems.length}
          contentClassName="flex flex-col gap-1 p-1 sm:p-1.5"
        >
          {fileItems.map((item) => {
            const itemList = item.isLocal ? localItems : attachmentItems;
            const itemIndex = itemList.findIndex((entry) => entry.id === item.id);
            const isUploadingInline = item.isLocal && item.memberIds.some((memberID) => uploadingLocalFileURLs.has(memberID));

            return (
              <AttachmentItemCard
                key={item.id}
                item={item}
                isUploadingInline={isUploadingInline}
                onPreview={
                  item.category === "image" || item.category === "video" || item.category === "motion"
                    ? () => handlePreviewItem(item)
                    : undefined
                }
                onRemove={isUploadingInline ? undefined : () => handleRemoveItem(item)}
                onMoveUp={item.isLocal ? () => handleMoveLocalFiles(item.id, -1) : () => handleMoveAttachments(item.id, -1)}
                onMoveDown={item.isLocal ? () => handleMoveLocalFiles(item.id, 1) : () => handleMoveAttachments(item.id, 1)}
                canMoveUp={itemIndex > 0}
                canMoveDown={itemIndex >= 0 && itemIndex < itemList.length - 1}
              />
            );
          })}
        </MetadataSection>
      )}

      <PreviewImageDialog
        open={previewState.open}
        onOpenChange={(open) => setPreviewState((state) => ({ ...state, open }))}
        items={previewItems}
        initialIndex={previewState.initialIndex}
      />
    </>
  );
};

export default AttachmentListEditor;
