import { create } from "@bufbuild/protobuf";
import {
  type DailyChecklist,
  DailyChecklistEveningReflectionSchema,
  DailyChecklistSchema,
  DailyChecklistTaskSchema,
  DailyChecklistTaskSectionSchema,
} from "@/types/proto/api/v1/daily_checklist_service_pb";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";

export interface DailyChecklistTaskDraft {
  id: string;
  content: string;
  completed: boolean;
}

export interface DailyChecklistDraft {
  firstTask: string;
  ifThen: string;
  mustWinTasks: DailyChecklistTaskDraft[];
  notes: string;
  mostEffectiveAction: string;
  biggestObstacle: string;
  obstacleResponse: string;
  keepForTomorrow: string;
  removeForTomorrow: string;
  // Kept to round-trip existing API data; new plans live on the date they belong to.
  firstTaskTomorrow: string;
  visibility: Visibility;
}

export type DailyChecklistState = "draft" | "planned" | "active" | "reflection_due" | "closed";

export interface DailyChecklistProgress {
  state: DailyChecklistState;
  hasContent: boolean;
  planCompleted: number;
  planReady: boolean;
  planTotal: 3;
  tasksCompleted: number;
  tasksTotal: number;
  tasksAllCompleted: boolean;
  reflectionCompleted: number;
  reflectionComplete: boolean;
  reflectionTotal: 5;
}

export const createDailyChecklistTaskDraft = (): DailyChecklistTaskDraft => ({
  id: crypto.randomUUID(),
  content: "",
  completed: false,
});

export const createEmptyDailyChecklistDraft = (): DailyChecklistDraft => ({
  firstTask: "",
  ifThen: "",
  mustWinTasks: [createDailyChecklistTaskDraft()],
  notes: "",
  mostEffectiveAction: "",
  biggestObstacle: "",
  obstacleResponse: "",
  keepForTomorrow: "",
  removeForTomorrow: "",
  firstTaskTomorrow: "",
  visibility: Visibility.PRIVATE,
});

export const dailyChecklistToDraft = (checklist?: DailyChecklist): DailyChecklistDraft => {
  if (!checklist) return createEmptyDailyChecklistDraft();
  return {
    firstTask: checklist.taskSection?.firstTask ?? "",
    ifThen: checklist.taskSection?.ifThen ?? "",
    mustWinTasks: checklist.taskSection?.mustWinTasks.length
      ? checklist.taskSection.mustWinTasks.map((task) => ({ id: task.id, content: task.content, completed: task.completed }))
      : [createDailyChecklistTaskDraft()],
    notes: checklist.taskSection?.notes ?? "",
    mostEffectiveAction: checklist.eveningReflection?.mostEffectiveAction ?? "",
    biggestObstacle: checklist.eveningReflection?.biggestObstacle ?? "",
    obstacleResponse: checklist.eveningReflection?.obstacleResponse ?? "",
    keepForTomorrow: checklist.eveningReflection?.keepForTomorrow ?? "",
    removeForTomorrow: checklist.eveningReflection?.removeForTomorrow ?? "",
    firstTaskTomorrow: checklist.eveningReflection?.firstTaskTomorrow ?? "",
    visibility: checklist.visibility === Visibility.PUBLIC ? Visibility.PUBLIC : Visibility.PRIVATE,
  };
};

export const dailyChecklistFromDraft = (name: string, date: string, draft: DailyChecklistDraft): DailyChecklist => {
  const tasks = draft.mustWinTasks
    .filter((task) => task.content.trim().length > 0)
    .map((task) => create(DailyChecklistTaskSchema, { id: task.id, content: task.content.trim(), completed: task.completed }));

  return create(DailyChecklistSchema, {
    name,
    date,
    visibility: draft.visibility,
    taskSection: create(DailyChecklistTaskSectionSchema, {
      firstTask: draft.firstTask.trim(),
      ifThen: draft.ifThen.trim(),
      mustWinTasks: tasks,
      notes: draft.notes.trim(),
    }),
    eveningReflection: create(DailyChecklistEveningReflectionSchema, {
      mostEffectiveAction: draft.mostEffectiveAction.trim(),
      biggestObstacle: draft.biggestObstacle.trim(),
      obstacleResponse: draft.obstacleResponse.trim(),
      keepForTomorrow: draft.keepForTomorrow.trim(),
      removeForTomorrow: draft.removeForTomorrow.trim(),
      firstTaskTomorrow: draft.firstTaskTomorrow.trim(),
    }),
  });
};

export const getDailyChecklistProgress = (
  draft: DailyChecklistDraft,
  date: string,
  today = getLocalDateString(),
): DailyChecklistProgress => {
  const tasks = draft.mustWinTasks.filter((task) => task.content.trim());
  const reflectionValues = [
    draft.mostEffectiveAction,
    draft.biggestObstacle,
    draft.obstacleResponse,
    draft.keepForTomorrow,
    draft.removeForTomorrow,
  ];
  const planCompleted = Number(Boolean(draft.firstTask.trim())) + Number(Boolean(draft.ifThen.trim())) + Number(tasks.length > 0);
  const tasksCompleted = tasks.filter((task) => task.completed).length;
  const tasksAllCompleted = tasks.length > 0 && tasksCompleted === tasks.length;
  const reflectionCompleted = reflectionValues.filter((value) => value.trim()).length;
  const hasContent =
    planCompleted > 0 || Boolean(draft.notes.trim()) || reflectionCompleted > 0 || draft.mustWinTasks.some((task) => task.completed);
  const planReady = planCompleted === 3;
  const reflectionComplete = reflectionCompleted === reflectionValues.length;

  let state: DailyChecklistState;
  if (reflectionComplete) state = "closed";
  else if (!planReady) state = "draft";
  else if (reflectionCompleted > 0 || date < today || tasksAllCompleted) state = "reflection_due";
  else if (date > today) state = "planned";
  else state = "active";

  return {
    state,
    hasContent,
    planCompleted,
    planReady,
    planTotal: 3,
    tasksCompleted,
    tasksTotal: tasks.length,
    tasksAllCompleted,
    reflectionCompleted,
    reflectionComplete,
    reflectionTotal: 5,
  };
};

export const getLocalDateString = (date = new Date()): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const isDailyChecklistDate = (value: string | null | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.valueOf()) && getLocalDateString(date) === value;
};

export const shiftDailyChecklistDate = (value: string, days: number): string => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
};
