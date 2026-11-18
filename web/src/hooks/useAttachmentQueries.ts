import { create } from "@bufbuild/protobuf";
import { FieldMaskSchema } from "@bufbuild/protobuf/wkt";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { attachmentServiceClient } from "@/connect";
import {
  AttachmentSchema,
  BatchDeleteAttachmentsRequestSchema,
  type ListAttachmentsRequest,
  ListAttachmentsRequestSchema,
} from "@/types/proto/api/v1/attachment_service_pb";
import { memoKeys } from "./useMemoQueries";

const attachmentListKey = ["attachments", "list"] as const;

export type AttachmentListOptions = Partial<Pick<ListAttachmentsRequest, "pageSize" | "filter" | "orderBy">>;

export function useInfiniteAttachments(request: AttachmentListOptions = {}, options?: { enabled?: boolean }) {
  return useInfiniteQuery({
    queryKey: [...attachmentListKey, request],
    queryFn: ({ pageParam }) =>
      attachmentServiceClient.listAttachments(create(ListAttachmentsRequestSchema, { ...request, pageToken: pageParam })),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextPageToken || undefined,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 5,
    enabled: options?.enabled ?? true,
  });
}

export function useUpdateAttachment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: { name: string; filename: string } | { name: string; allowOriginal: boolean }) =>
      attachmentServiceClient.updateAttachment({
        attachment: create(AttachmentSchema, update),
        updateMask: create(FieldMaskSchema, { paths: ["filename" in update ? "filename" : "allow_original"] }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: attachmentListKey });
      void queryClient.invalidateQueries({ queryKey: memoKeys.all });
    },
  });
}

export function useBatchDeleteAttachments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (names: string[]) => attachmentServiceClient.batchDeleteAttachments(create(BatchDeleteAttachmentsRequestSchema, { names })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: attachmentListKey });
    },
  });
}
