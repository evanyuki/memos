import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import MemoContent from "@/components/MemoContent";
import { MentionResolutionProvider } from "@/components/MemoContent/MentionResolutionContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { type GalleryPhoto, galleryKeys } from "@/hooks/useGalleryQueries";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { withShareAttachmentLinks } from "@/hooks/useMemoShareQueries";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";
import { GalleryExifSection } from "./GalleryExifSection";

export default function GalleryMemoDetails({ photo, shareToken }: { photo: GalleryPhoto; shareToken?: string }) {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const updateMemo = useUpdateMemo();
  const [visibilityTarget, setVisibilityTarget] = useState<Visibility>();
  const { memo } = photo;
  const canEdit = !shareToken && (currentUser?.name === memo.creator || isSuperUser(currentUser));
  const attachments = shareToken ? withShareAttachmentLinks(memo.attachments, shareToken) : memo.attachments;
  const changeVisibility = async () => {
    if (visibilityTarget === undefined) return;
    try {
      await updateMemo.mutateAsync({ update: { name: memo.name, visibility: visibilityTarget }, updateMask: ["visibility"] });
      await queryClient.invalidateQueries({ queryKey: galleryKeys.all });
    } catch (error) {
      toast.error(t("gallery.visibility-error"));
      throw error;
    }
  };
  return (
    <GalleryExifSection title={t("common.description")}>
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
        <MemoContent
          content={memo.content}
          memoName={memo.name}
          attachments={attachments}
          contentClassName="text-sm leading-6"
          standalone
        />
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
