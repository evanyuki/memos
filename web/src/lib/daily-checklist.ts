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
  firstTaskTomorrow: string;
  visibility: Visibility;
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
    mustWinTasks:
      checklist.taskSection?.mustWinTasks.length === 0
        ? [createDailyChecklistTaskDraft()]
        : (checklist.taskSection?.mustWinTasks.map((task) => ({ id: task.id, content: task.content, completed: task.completed })) ?? []),
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
