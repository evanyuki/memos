import { timestampDate } from "@bufbuild/protobuf/wkt";
import { LoaderCircleIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/contexts/AuthContext";
import type { GalleryPhoto } from "@/hooks/useGalleryQueries";
import { getShareUrl, useMemoShares } from "@/hooks/useMemoShareQueries";
import { usePhotoAnalysis } from "@/hooks/usePhotoAnalysis";
import { cn } from "@/lib/utils";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentThumbnailUrl } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import GalleryShareActions from "./GalleryShareActions";
import { galleryAccentStyle } from "./gallery-accent";

function SharePreview({ src, title }: { src: string; title: string }) {
  const t = useTranslate();
  const [status, setStatus] = useState<"loading" | "loaded" | "error">("loading");
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{t("common.preview")}</p>
      <div
        className="relative aspect-[1200/628] max-h-[34dvh] w-full overflow-hidden rounded-xl border border-primary/20 bg-[var(--gallery-fill)]"
        aria-busy={status === "loading"}
      >
        {status === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <LoaderCircleIcon className="size-8 animate-spin" aria-label={t("resource.fetching-data")} />
          </div>
        )}
        {status === "error" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p role="status" className="text-sm text-muted-foreground">
              {t("gallery.preview-error")}
            </p>
            <Button variant="secondary" size="sm" onClick={() => setStatus("loading")}>
              {t("gallery.retry")}
            </Button>
          </div>
        ) : (
          <img
            src={src}
            alt={title}
            className={cn("absolute inset-0 size-full object-contain transition-opacity duration-200", status !== "loaded" && "opacity-0")}
            onLoad={() => setStatus("loaded")}
            onError={() => setStatus("error")}
          />
        )}
      </div>
    </div>
  );
}

function PrivatePhotoShareActions({ photo, title }: { photo: GalleryPhoto; title: string }) {
  const { data: shares = [], isError } = useMemoShares(photo.memo.name);
  const share = isError
    ? undefined
    : shares.find((candidate) => !candidate.expireTime || timestampDate(candidate.expireTime).getTime() > Date.now());
  const uid = photo.attachment.name.split("/").pop()!;
  return <GalleryShareActions attachment={photo.attachment} shareUrl={share ? getShareUrl(share, uid) : undefined} title={title} />;
}

export default function GallerySharePanel({ photo, onClose }: { photo: GalleryPhoto; onClose: () => void }) {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const { memo, attachment } = photo;
  const owner = currentUser?.name === memo.creator;
  const uid = attachment.name.split("/").pop()!;
  const title = attachment.filename.replace(/\.[^.]+$/, "");
  const thumbnailUrl = getAttachmentThumbnailUrl(attachment);
  const analysis = usePhotoAnalysis(thumbnailUrl);
  const publicUrl =
    memo.visibility === Visibility.PUBLIC ? `${window.location.origin}/gallery/photos/${encodeURIComponent(uid)}` : undefined;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="2xl"
        className="gallery-theme gallery-page-header-popover rounded-2xl shadow-none transition-opacity md:max-w-3xl"
        style={galleryAccentStyle(analysis.data?.palette)}
      >
        <DialogHeader className="min-w-0 pr-6 text-left">
          <p className="text-xs font-medium text-muted-foreground">{t("gallery.share-photo")}</p>
          <DialogTitle className="break-words text-lg font-semibold">{title}</DialogTitle>
        </DialogHeader>
        <SharePreview key={thumbnailUrl} src={thumbnailUrl} title={title} />
        {!publicUrl && owner ? (
          <PrivatePhotoShareActions photo={photo} title={title} />
        ) : (
          <GalleryShareActions attachment={attachment} shareUrl={publicUrl} title={title} />
        )}
      </DialogContent>
    </Dialog>
  );
}
