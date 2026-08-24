import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { describe, expect, it, vi } from "vitest";
import { useDailyChecklist } from "@/hooks/useDailyChecklistQueries";
import {
  type DailyChecklistDraft,
  dailyChecklistFromDraft,
  getLocalDateString,
  isDailyChecklistDate,
  shiftDailyChecklistDate,
} from "@/lib/daily-checklist";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

const clients = vi.hoisted(() => ({
  getDailyChecklist: vi.fn(),
}));

vi.mock("@/connect", () => ({
  dailyChecklistServiceClient: {
    getDailyChecklist: clients.getDailyChecklist,
  },
}));

const draft = (): DailyChecklistDraft => ({
  firstTask: "  Start with the plan  ",
  ifThen: "  If distracted, close the feed  ",
  mustWinTasks: [
    { id: "task-1", content: "  Ship it  ", completed: true },
    { id: "task-empty", content: "   ", completed: false },
  ],
  notes: "  Keep it small  ",
  mostEffectiveAction: "  Focus block  ",
  biggestObstacle: "Notifications",
  obstacleResponse: "Muted them",
  keepForTomorrow: "Morning focus",
  removeForTomorrow: "Late meetings",
  firstTaskTomorrow: "Open the plan",
  visibility: Visibility.PUBLIC,
});

describe("daily checklist model", () => {
  it("treats a missing checklist as an editable empty state", async () => {
    clients.getDailyChecklist.mockRejectedValueOnce(new ConnectError("daily checklist not found", Code.NotFound));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: PropsWithChildren) => createElement(QueryClientProvider, { client: queryClient }, children);
    const { result } = renderHook(() => useDailyChecklist("users/test/dailyChecklists/2026-08-24"), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("normalizes a draft into the structured API resource", () => {
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", draft());

    expect(checklist.name).toBe("users/test/dailyChecklists/2026-08-24");
    expect(checklist.date).toBe("2026-08-24");
    expect(checklist.visibility).toBe(Visibility.PUBLIC);
    expect(checklist.taskSection?.firstTask).toBe("Start with the plan");
    expect(checklist.taskSection?.mustWinTasks).toHaveLength(1);
    expect(checklist.taskSection?.mustWinTasks[0]).toMatchObject({ id: "task-1", content: "Ship it", completed: true });
    expect(checklist.eveningReflection?.mostEffectiveAction).toBe("Focus block");
  });

  it("validates real calendar dates", () => {
    expect(isDailyChecklistDate("2024-02-29")).toBe(true);
    expect(isDailyChecklistDate("2026-02-29")).toBe(false);
    expect(isDailyChecklistDate("2026-02-30")).toBe(false);
    expect(isDailyChecklistDate("2026-8-24")).toBe(false);
  });

  it("shifts dates across month and year boundaries", () => {
    expect(shiftDailyChecklistDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDailyChecklistDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDailyChecklistDate("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("formats a date using local calendar components", () => {
    expect(getLocalDateString(new Date(2026, 7, 4, 23, 59))).toBe("2026-08-04");
  });
});
