import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { GalleryPhoto } from "@/hooks/useGalleryQueries";
import { withShareAttachmentLinks } from "@/hooks/useMemoShareQueries";
import { findTagMetadata } from "@/lib/tag";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { useTranslate } from "@/utils/i18n";
import { buildAttachmentVisualItems } from "@/utils/media-item";
import GalleryMemoDetails from "./GalleryMemoDetails";
import GalleryPhotoViewer from "./GalleryPhotoViewer";
import GallerySharePanel from "./GallerySharePanel";
import { getGalleryAttachments } from "./gallery-media";

export default function GalleryPhotoView({ photo, shareToken }: { photo: GalleryPhoto; shareToken?: string }) {
  const t = useTranslate();
  const { currentUser, userTagsSetting } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [details, setDetails] = useState(false);
  const [share, setShare] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { memo, attachment } = photo;
  const uid = attachment.name.split("/").pop()!;
  const owner = !shareToken && currentUser?.name === memo.creator;
  const canShare = !shareToken && (owner || memo.visibility === Visibility.PUBLIC);
  const blurred = memo.tags.some((tag) => userTagsSetting && findTagMetadata(tag, userTagsSetting)?.blurContent) && !revealed;
  const items = useMemo(() => {
    const photos = getGalleryAttachments(memo.attachments);
    return buildAttachmentVisualItems(shareToken ? withShareAttachmentLinks(photos, shareToken) : photos).filter(
      (item) => item.kind !== "video",
    );
  }, [memo.attachments, shareToken]);
  const item = items.find((item) => item.attachmentNames.includes(attachment.name)) ?? buildAttachmentVisualItems([attachment])[0];
  const itemIndex = Math.max(
    0,
    items.findIndex((candidate) => candidate.id === item.id),
  );
  const siblingUids = items.map((item) => item.attachments[0].name.split("/").pop()!);
  const stateIds: unknown = location.state?.photoUids;
  const photoUids =
    !shareToken && Array.isArray(stateIds) && stateIds.every((id) => typeof id === "string") && stateIds.includes(uid)
      ? (stateIds as string[])
      : siblingUids;
  const index = photoUids.indexOf(uid);
  const previous = index > 0 ? photoUids[index - 1] : undefined;
  const next = index >= 0 ? photoUids[index + 1] : undefined;
  const filters = new URLSearchParams(location.search);
  filters.delete("viewer");
  filters.delete("share_token");
  const galleryPath = `/gallery${!shareToken && filters.size ? `?${filters}` : ""}`;
  const go = (id: string) =>
    navigate(`/gallery/photos/${encodeURIComponent(id)}${location.search}`, {
      replace: true,
      state: { ...location.state, photoUids },
    });

  if (blurred)
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6">
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="rounded-xl p-8 text-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("memo.click-to-show-sensitive-content")}
        </button>
        <Link to={galleryPath} className="text-sm underline">
          {t("gallery.title")}
        </Link>
      </div>
    );

  return (
    <GalleryPhotoViewer
      item={item.previewItem}
      thumbnails={items.map((candidate) => candidate.previewItem)}
      currentIndex={itemIndex}
      showInspector={details}
      onInspectorChange={setDetails}
      onClose={() => (!shareToken && location.state?.galleryReturn ? navigate(-1) : navigate(galleryPath))}
      onPrevious={previous ? () => go(previous) : undefined}
      onNext={next ? () => go(next) : undefined}
      onSelect={(selectedIndex) => go(siblingUids[selectedIndex])}
      onShare={canShare ? () => setShare(true) : undefined}
      inspectorContent={<GalleryMemoDetails photo={photo} shareToken={shareToken} />}
    >
      {canShare && share && <GallerySharePanel photo={photo} onClose={() => setShare(false)} />}
    </GalleryPhotoViewer>
  );
}
