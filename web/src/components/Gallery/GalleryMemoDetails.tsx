import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemoContent from "@/components/MemoContent";
import { MentionResolutionProvider } from "@/components/MemoContent/MentionResolutionContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useUpdateAttachment } from "@/hooks/useAttachmentQueries";
import { type GalleryPhoto, galleryKeys } from "@/hooks/useGalleryQueries";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { getAttachmentUrl, isAppleLivePhotoStill, isAppleLivePhotoVideo } from "@/utils/attachment";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";
import { GalleryExifSection } from "./GalleryExifSection";

export default function GalleryMemoDetails({ photo, shareToken }: { photo: GalleryPhoto; shareToken?: string }) {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const updateMemo = useUpdateMemo();
  const updateAttachment = useUpdateAttachment();
  const [visibilityTarget, setVisibilityTarget] = useState<Visibility>();
  const { memo } = photo;
  const owner = !shareToken && currentUser?.name === memo.creator;
  const companion = isAppleLivePhotoStill(photo.attachment)
    ? memo.attachments.find((a) => isAppleLivePhotoVideo(a) && a.motionMedia?.groupId === photo.attachment.motionMedia?.groupId)
    : undefined;
  const originalFiles = companion ? [photo.attachment, companion] : [photo.attachment];
  const canEdit = !shareToken && (currentUser?.name === memo.creator || isSuperUser(currentUser));
  const changeVisibility = async () => {
    if (visibilityTarget === undefined) return;
    try {
      await updateMemo.mutateAsync({ update: { name: memo.name, visibility: visibilityTarget }, updateMask: ["visibility"] });
      void queryClient.invalidateQueries({ queryKey: galleryKeys.all });
    } catch (error) {
      toast.error(t("gallery.visibility-error"));
      throw error;
    }
  };
  return (
    <GalleryExifSection title={t("common.description")}>
      {owner && (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={photo.attachment.allowOriginal}
              disabled={updateAttachment.isPending}
              onChange={(event) =>
                updateAttachment.mutate(
                  { name: photo.attachment.name, allowOriginal: event.target.checked },
                  {
                    onSuccess: (updated) => {
                      if (currentUser) {
                        const uid = updated.name.split("/").pop()!;
                        queryClient.setQueryData(galleryKeys.photo(currentUser.name, uid), { memo, attachment: updated });
                      }
                      void queryClient.invalidateQueries({ queryKey: galleryKeys.all });
                    },
                    onError: () => toast.error(t("gallery.original-error")),
                  },
                )
              }
            />
            {t(companion ? "gallery.allow-live-original" : "gallery.allow-original")}
          </label>
          <p className="text-xs text-muted-foreground">
            {photo.attachment.locationStatus === "present"
              ? t("gallery.location-present")
              : photo.attachment.locationStatus === "not_found"
                ? t("gallery.location-not-found")
                : t("gallery.location-unknown")}
          </p>
        </div>
      )}
      {(owner || photo.attachment.allowOriginal) &&
        originalFiles.map((file) => {
          const url = new URL(getAttachmentUrl(file), window.location.origin);
          url.searchParams.set("original", "true");
          if (shareToken) url.searchParams.set("share_token", shareToken);
          return (
            <a key={file.name} href={url.href} download={file.filename} className="block text-sm underline">
              {t("gallery.download-original")}
              {companion && ` · ${file.filename}`}
            </a>
          );
        })}
      {memo.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {memo.tags.map((tag) => (
            <Link
              key={tag}
              className="rounded-full bg-muted px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring"
              to={`/gallery?${new URLSearchParams({ tag })}`}
            >
              #{tag}
            </Link>
          ))}
        </div>
      )}
      <MentionResolutionProvider contents={[memo.content]} userNames={[memo.creator]}>
        <MemoContent content={memo.content} memoName={memo.name} contentClassName="text-sm leading-6" standalone hideImages />
      </MentionResolutionProvider>
      <Link
        to={shareToken ? `/memos/shares/${encodeURIComponent(shareToken)}` : `/${memo.name}`}
        className="text-xs text-muted-foreground underline underline-offset-4"
      >
        {t("gallery.open-memo")}
      </Link>
      {canEdit && (
        <fieldset className="mt-2 space-y-2">
          <legend className="text-xs text-muted-foreground">{t("gallery.visibility")}</legend>
          <div className="flex flex-wrap gap-1">
            {[Visibility.PUBLIC, Visibility.PRIVATE, Visibility.PROTECTED].map((visibility) => (
              <Button
                key={visibility}
                size="sm"
                className="h-7 text-xs"
                variant={memo.visibility === visibility ? "secondary" : "ghost"}
                disabled={memo.visibility === visibility}
                onClick={() => setVisibilityTarget(visibility)}
              >
                {t(
                  `gallery.visibility-${visibility === Visibility.PUBLIC ? "public" : visibility === Visibility.PROTECTED ? "protected" : "private"}`,
                )}
              </Button>
            ))}
          </div>
        </fieldset>
      )}
      <ConfirmDialog
        open={visibilityTarget !== undefined}
        onOpenChange={(open) => !open && setVisibilityTarget(undefined)}
        title={t("gallery.change-visibility")}
        description={t("gallery.visibility-scope")}
        confirmLabel={t("common.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={changeVisibility}
      />
    </GalleryExifSection>
  );
}
