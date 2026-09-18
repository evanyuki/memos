import { CameraIcon, CopyIcon, DownloadIcon, LoaderCircleIcon, SendIcon, Share2Icon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Button, buttonVariants } from "@/components/ui/button";
import { useGalleryShareFile } from "@/hooks/useGalleryShareFile";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { useTranslate } from "@/utils/i18n";
import { downloadGalleryShareFile, getSocialShareUrl } from "./gallery-share";

export default function GalleryShareActions({ attachment, shareUrl, title }: { attachment: Attachment; shareUrl?: string; title: string }) {
  const t = useTranslate();
  const fileQuery = useGalleryShareFile(attachment);
  const [sharing, setSharing] = useState(false);
  const file = fileQuery.data;
  const canShare = typeof navigator.share === "function";
  const canShareFiles = !!(canShare && file && navigator.canShare?.({ files: [file] }));
  const showSystemShare = canShare && (!!shareUrl || canShareFiles);

  const copyLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      toast.success(t("gallery.link-copied"));
    } catch {
      toast.error(t("gallery.copy-error"));
    }
  };

  const share = async (instagram = false) => {
    if (sharing || (!shareUrl && !file)) return;
    const files = file ? [file] : [];
    if (instagram && !canShareFiles) {
      if (file) {
        downloadGalleryShareFile(file);
        if (shareUrl) await copyLink();
        toast.success(t("gallery.share-instagram-download"));
      }
      return;
    }
    if (!canShare) return;
    if (!shareUrl && !canShareFiles) return;
    try {
      setSharing(true);
      // Prepared files keep this call inside the click's transient user activation.
      await navigator.share(instagram ? { files } : { title, ...(shareUrl ? { url: shareUrl } : {}), ...(canShareFiles ? { files } : {}) });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(t("gallery.share-error"));
    } finally {
      setSharing(false);
    }
  };

  return (
    <div className="space-y-3">
      {shareUrl && (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border border-primary/20 bg-[var(--gallery-fill)] px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={shareUrl}>
            {shareUrl}
          </span>
          <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={copyLink} aria-label={t("gallery.copy-link")}>
            <CopyIcon className="size-4" />
          </Button>
        </div>
      )}
      <div
        className={cn(
          "grid gap-2",
          shareUrl || showSystemShare ? "grid-cols-3" : "grid-cols-2",
          shareUrl && (showSystemShare ? "sm:grid-cols-5" : "sm:grid-cols-4"),
        )}
      >
        {shareUrl && (
          <>
            <a
              className={cn(buttonVariants({ variant: "outline" }), "h-auto flex-col gap-2 py-3")}
              href={getSocialShareUrl("x", shareUrl, title)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="text-lg leading-5" aria-hidden="true">
                𝕏
              </span>
              <span className="text-xs">X</span>
            </a>
            <a
              className={cn(buttonVariants({ variant: "outline" }), "h-auto flex-col gap-2 py-3")}
              href={getSocialShareUrl("telegram", shareUrl, title)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SendIcon className="size-5" aria-hidden="true" />
              <span className="text-xs">Telegram</span>
            </a>
          </>
        )}
        <Button variant="outline" className="h-auto flex-col gap-2 py-3" disabled={!file || sharing} onClick={() => void share(true)}>
          <CameraIcon className="size-5" aria-hidden="true" />
          <span className="text-xs">Instagram</span>
        </Button>
        {showSystemShare && (
          <Button
            variant="outline"
            className="h-auto flex-col gap-2 py-3"
            disabled={sharing || (!shareUrl && !file)}
            onClick={() => void share()}
          >
            <Share2Icon className="size-5" aria-hidden="true" />
            <span className="text-xs">{t("gallery.share-system")}</span>
          </Button>
        )}
        <Button
          variant="outline"
          className="h-auto flex-col gap-2 py-3"
          disabled={!file}
          onClick={() => file && downloadGalleryShareFile(file)}
        >
          <DownloadIcon className="size-5" aria-hidden="true" />
          <span className="text-xs">{t("gallery.share-download")}</span>
        </Button>
      </div>
      {fileQuery.isLoading && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
          <LoaderCircleIcon className="size-3 animate-spin" aria-hidden="true" />
          {t("gallery.share-preparing-image")}
        </p>
      )}
      {fileQuery.isError && (
        <div role="alert" className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{t("gallery.share-image-error")}</span>
          <Button variant="ghost" size="sm" onClick={() => void fileQuery.refetch()}>
            {t("gallery.retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
