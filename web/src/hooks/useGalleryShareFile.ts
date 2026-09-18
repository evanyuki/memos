import { useQuery } from "@tanstack/react-query";
import { fetchGalleryShareFile } from "@/components/Gallery/gallery-share";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";

export function useGalleryShareFile(attachment: Attachment) {
  return useQuery({
    queryKey: ["gallery-share-file", getAttachmentUrl(attachment)],
    queryFn: ({ signal }) => fetchGalleryShareFile(attachment, signal),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
}
