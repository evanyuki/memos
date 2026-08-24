import { Code, ConnectError } from "@connectrpc/connect";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { useDailyChecklist } from "@/hooks/useDailyChecklistQueries";
import {
  createEmptyDailyChecklistDraft,
  type DailyChecklistDraft,
  dailyChecklistFromDraft,
  getDailyChecklistProgress,
  getLocalDateString,
  isDailyChecklistDate,
  shiftDailyChecklistDate,
} from "@/lib/daily-checklist";
import DailyChecklistPage, { ChecklistEditor } from "@/pages/DailyChecklist";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

const clients = vi.hoisted(() => ({
  deleteDailyChecklist: vi.fn(),
  getDailyChecklist: vi.fn(),
  upsertDailyChecklist: vi.fn(),
}));

const toasts = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

vi.mock("@/connect", () => ({
  dailyChecklistServiceClient: {
    deleteDailyChecklist: clients.deleteDailyChecklist,
    getDailyChecklist: clients.getDailyChecklist,
    upsertDailyChecklist: clients.upsertDailyChecklist,
  },
}));

vi.mock("@/utils/i18n", () => ({
  useTranslate: () => (key: string, params?: Record<string, unknown>) => (params?.task ? `${key}:${params.task}` : key),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ i18n: { language: "en" } }),
}));

vi.mock("@/hooks/useCurrentUser", () => ({
  default: () => ({ username: "test" }),
}));

vi.mock("react-hot-toast", () => ({ default: toasts }));

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

  it("autosaves task completion and keeps editing and deletion available", async () => {
    clients.deleteDailyChecklist.mockResolvedValue({});
    clients.upsertDailyChecklist.mockImplementation(async ({ dailyChecklist }) => dailyChecklist);
    const checklistDraft = draft();
    checklistDraft.mustWinTasks[0].completed = false;
    checklistDraft.removeForTomorrow = "";
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", checklistDraft);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: false,
          username: "test",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() =>
      expect(clients.upsertDailyChecklist).toHaveBeenCalledWith({
        dailyChecklist: expect.objectContaining({
          taskSection: expect.objectContaining({ mustWinTasks: [expect.objectContaining({ content: "Ship it", completed: true })] }),
        }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.adjust-plan" }));
    const task = screen.getByDisplayValue("Ship it");
    fireEvent.change(task, { target: { value: "Edited task" } });
    expect(task).toHaveValue("Edited task");

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.remove-task" }));
    expect(screen.queryByDisplayValue("Edited task")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.save-plan" }));
    await waitFor(() => expect(clients.upsertDailyChecklist).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.visibility-label" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "daily-checklist.delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "common.delete" }));

    await waitFor(() => expect(clients.deleteDailyChecklist).toHaveBeenCalledWith({ name: checklist.name }));
    expect(toasts.success).toHaveBeenCalledWith("daily-checklist.deleted");
  });

  it("rolls back a task toggle when autosave fails", async () => {
    clients.upsertDailyChecklist.mockClear();
    toasts.error.mockClear();
    clients.upsertDailyChecklist.mockRejectedValueOnce(new ConnectError("save failed", Code.Unavailable));
    const checklistDraft = draft();
    checklistDraft.mustWinTasks[0].completed = false;
    checklistDraft.removeForTomorrow = "";
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", checklistDraft);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: false,
          username: "test",
        }),
      ),
    );

    const task = screen.getByRole("checkbox");
    fireEvent.click(task);
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(task).not.toBeChecked();
  });

  it("renders public checklists as content instead of form controls", () => {
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", draft());
    const queryClient = new QueryClient();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: true,
          username: "test",
        }),
      ),
    );

    expect(screen.getByText("Start with the plan")).toBeInTheDocument();
    expect(screen.getByText("Focus block")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("renders a closed checklist as a summary while keeping explicit edit actions", () => {
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", draft());
    const queryClient = new QueryClient();
    const onDateChange = vi.fn();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: false,
          username: "test",
          onDateChange,
        }),
      ),
    );

    expect(screen.getByText("daily-checklist.states.closed")).toBeInTheDocument();
    expect(screen.queryByText("daily-checklist.eyebrow")).not.toBeInTheDocument();
    expect(screen.queryByText("daily-checklist.plan-progress-count")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "daily-checklist.adjust-plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "daily-checklist.edit-reflection" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.plan-next-day" }));
    expect(onDateChange).toHaveBeenCalledWith("2026-08-25");
  });

  it("limits a new daily plan to three must-win results", () => {
    const checklistDraft = draft();
    checklistDraft.mustWinTasks[1].content = "Second result";
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", checklistDraft);
    const queryClient = new QueryClient();

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: false,
          username: "test",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.adjust-plan" }));
    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.add-task" }));

    expect(screen.getAllByLabelText("daily-checklist.task-number")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "daily-checklist.add-task" })).not.toBeInTheDocument();
  });

  it("does not close or implicitly save the day while reflection edits are unsaved", async () => {
    clients.upsertDailyChecklist.mockClear();
    clients.upsertDailyChecklist.mockImplementation(async ({ dailyChecklist }) => dailyChecklist);
    const checklistDraft = draft();
    checklistDraft.removeForTomorrow = "";
    const checklist = dailyChecklistFromDraft("users/test/dailyChecklists/2026-08-24", "2026-08-24", checklistDraft);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });

    render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(ChecklistEditor, {
          checklist,
          date: "2026-08-24",
          name: checklist.name,
          readonly: false,
          username: "test",
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.continue-reflection" }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText("daily-checklist.reflection.today-title")).toBeInTheDocument();
    expect(screen.getByText("daily-checklist.reflection.tomorrow-title")).toBeInTheDocument();
    expect(screen.queryByLabelText(/daily-checklist\.fields\.first-task-tomorrow/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/daily-checklist\.fields\.remove-for-tomorrow/), { target: { value: "Late meetings" } });

    expect(screen.getByText("daily-checklist.states.reflection_due")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "daily-checklist.save-and-close" })).toBeEnabled();
    expect(clients.upsertDailyChecklist).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.save-and-close" }));

    await waitFor(() => expect(screen.getByText("daily-checklist.states.closed")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "daily-checklist.plan-next-day" })).toBeInTheDocument();
  });

  it("blocks checklist navigation while the plan has unsaved changes", async () => {
    clients.getDailyChecklist.mockRejectedValueOnce(new ConnectError("daily checklist not found", Code.NotFound));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [
        { path: "/daily-checklist", element: createElement(DailyChecklistPage) },
        { path: "/other", element: createElement("div", undefined, "Other page") },
      ],
      { initialEntries: ["/daily-checklist?date=2026-08-24"] },
    );

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(RouterProvider, { router })));

    fireEvent.change(await screen.findByLabelText("daily-checklist.fields.first-task"), { target: { value: "Start now" } });
    await waitFor(() => expect(screen.getByText("daily-checklist.unsaved")).toBeInTheDocument());

    act(() => {
      void router.navigate("/other");
    });
    expect(await screen.findByText("daily-checklist.discard-confirm-title")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "daily-checklist.discard" }));
    expect(await screen.findByText("Other page")).toBeInTheDocument();
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
    expect(checklist.eveningReflection?.firstTaskTomorrow).toBe("Open the plan");
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

  it("derives planning, execution, reflection, and closure independently", () => {
    const empty = createEmptyDailyChecklistDraft();
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24").state).toBe("draft");

    empty.firstTask = "Open the plan";
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24")).toMatchObject({ state: "draft", planCompleted: 1 });

    empty.ifThen = "If distracted, close the feed";
    empty.mustWinTasks[0].content = "Ship the plan";
    expect(getDailyChecklistProgress(empty, "2026-08-25", "2026-08-24").state).toBe("planned");
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24").state).toBe("active");
    expect(getDailyChecklistProgress(empty, "2026-08-23", "2026-08-24").state).toBe("reflection_due");

    empty.mustWinTasks[0].completed = true;
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24").state).toBe("reflection_due");
    empty.mustWinTasks[0].completed = false;

    empty.mostEffectiveAction = "Focus";
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24").state).toBe("reflection_due");

    empty.biggestObstacle = "Noise";
    empty.obstacleResponse = "Moved rooms";
    empty.keepForTomorrow = "Focus block";
    empty.removeForTomorrow = "Notifications";
    expect(getDailyChecklistProgress(empty, "2026-08-24", "2026-08-24")).toMatchObject({
      state: "closed",
      tasksAllCompleted: false,
      reflectionComplete: true,
      reflectionTotal: 5,
    });
  });
});
