import { Code, ConnectError } from "@connectrpc/connect";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dailyChecklistServiceClient } from "@/connect";
import type { DailyChecklist } from "@/types/proto/api/v1/daily_checklist_service_pb";

export const dailyChecklistKeys = {
  all: ["daily-checklists"] as const,
  detail: (name: string) => [...dailyChecklistKeys.all, name] as const,
};

export function useDailyChecklist(name: string) {
  return useQuery({
    queryKey: dailyChecklistKeys.detail(name),
    enabled: Boolean(name),
    queryFn: async (): Promise<DailyChecklist | undefined> => {
      try {
        return await dailyChecklistServiceClient.getDailyChecklist({ name });
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          return undefined;
        }
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useUpsertDailyChecklist(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dailyChecklist: DailyChecklist) => dailyChecklistServiceClient.upsertDailyChecklist({ dailyChecklist }),
    onSuccess: (dailyChecklist) => {
      queryClient.setQueryData(dailyChecklistKeys.detail(name), dailyChecklist);
    },
  });
}

export function useDeleteDailyChecklist(name: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dailyChecklistServiceClient.deleteDailyChecklist({ name }),
    onSuccess: () => {
      queryClient.setQueryData(dailyChecklistKeys.detail(name), undefined);
    },
  });
}
