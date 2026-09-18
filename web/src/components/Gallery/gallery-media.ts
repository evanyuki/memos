import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { isAppleLivePhotoStill, isAppleLivePhotoVideo } from "@/utils/attachment";
import type { PreviewMediaItem } from "@/utils/media-item";

export const getGalleryPreviewSource = (item: PreviewMediaItem) =>
  item.kind === "motion" ? item.posterUrl : (item.posterUrl ?? item.sourceUrl);

export function getGalleryAttachments(attachments: Attachment[]): Attachment[] {
  const photos = attachments.filter((attachment) => !attachment.externalLink && attachment.type.startsWith("image/"));
  const liveGroups = new Set(photos.filter(isAppleLivePhotoStill).map((attachment) => attachment.motionMedia!.groupId));
  return attachments.filter(
    (attachment) =>
      photos.includes(attachment) ||
      (!attachment.externalLink && isAppleLivePhotoVideo(attachment) && liveGroups.has(attachment.motionMedia!.groupId)),
  );
}
