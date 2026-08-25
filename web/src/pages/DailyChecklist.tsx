import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  CalendarCheck2Icon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Globe2Icon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useDailyChecklist, useDeleteDailyChecklist, useUpsertDailyChecklist } from "@/hooks/useDailyChecklistQueries";
import {
  createDailyChecklistTaskDraft,
  type DailyChecklistDraft,
  type DailyChecklistProgress,
  type DailyChecklistState,
  dailyChecklistFromDraft,
  dailyChecklistToDraft,
  getDailyChecklistProgress,
  getLocalDateString,
  isDailyChecklistDate,
  shiftDailyChecklistDate,
} from "@/lib/daily-checklist";
import { handleError } from "@/lib/error";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/router/routes";
import type { DailyChecklist } from "@/types/proto/api/v1/daily_checklist_service_pb";
import { Visibility } from "@/types/proto/api/v1/memo_service_pb";
import { type Translations, useTranslate } from "@/utils/i18n";

type EditingSection = "plan" | "reflection";
const MAX_DAILY_MUST_WIN_TASKS = 3;

type ReflectionKey = keyof Pick<
  DailyChecklistDraft,
  "mostEffectiveAction" | "biggestObstacle" | "obstacleResponse" | "keepForTomorrow" | "removeForTomorrow"
>;

interface ReflectionField {
  key: ReflectionKey;
  labelKey: Translations;
  placeholderKey: Translations;
}

interface ReflectionGroup {
  titleKey: Translations;
  descriptionKey: Translations;
  fields: ReflectionField[];
}

const reflectionGroups: ReflectionGroup[] = [
  {
    titleKey: "daily-checklist.reflection.today-title",
    descriptionKey: "daily-checklist.reflection.today-description",
    fields: [
      {
        key: "mostEffectiveAction",
        labelKey: "daily-checklist.fields.most-effective-action",
        placeholderKey: "daily-checklist.placeholders.most-effective-action",
      },
      {
        key: "biggestObstacle",
        labelKey: "daily-checklist.fields.biggest-obstacle",
        placeholderKey: "daily-checklist.placeholders.biggest-obstacle",
      },
      {
        key: "obstacleResponse",
        labelKey: "daily-checklist.fields.obstacle-response",
        placeholderKey: "daily-checklist.placeholders.obstacle-response",
      },
    ],
  },
  {
    titleKey: "daily-checklist.reflection.tomorrow-title",
    descriptionKey: "daily-checklist.reflection.tomorrow-description",
    fields: [
      {
        key: "keepForTomorrow",
        labelKey: "daily-checklist.fields.keep-for-tomorrow",
        placeholderKey: "daily-checklist.placeholders.keep-for-tomorrow",
      },
      {
        key: "removeForTomorrow",
        labelKey: "daily-checklist.fields.remove-for-tomorrow",
        placeholderKey: "daily-checklist.placeholders.remove-for-tomorrow",
      },
    ],
  },
];

const formatChecklistDate = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date(`${date}T12:00:00`));

const SectionProgress = ({ completed, total, label }: { completed: number; total: number; label: string }) => {
  const complete = completed === total;
  return (
    <span className={cn("flex items-center gap-1.5 text-xs font-medium", complete ? "text-primary" : "text-muted-foreground")}>
      {complete ? <CheckCircle2Icon className="size-4" aria-hidden="true" /> : <CircleIcon className="size-4" aria-hidden="true" />}
      <span>
        {label} {completed}/{total}
      </span>
    </span>
  );
};

const stateStyles: Record<DailyChecklistState, string> = {
  draft: "border-border bg-muted/40 text-muted-foreground",
  planned: "border-border bg-background text-foreground",
  active: "border-primary/30 bg-primary/10 text-primary",
  reflection_due: "border-border bg-muted/40 text-foreground",
  closed: "border-primary/30 bg-primary/10 text-primary",
};

const ChecklistStateBadge = ({ state }: { state: DailyChecklistState }) => {
  const t = useTranslate();
  return (
    <Badge variant="outline" shape="pill" className={stateStyles[state]}>
      {state === "closed" ? <CheckCircle2Icon aria-hidden="true" /> : <CircleIcon aria-hidden="true" />}
      {t(`daily-checklist.states.${state}`)}
    </Badge>
  );
};

interface PlanEditorProps {
  draft: DailyChecklistDraft;
  progress: DailyChecklistProgress;
  updateDraft: (update: (current: DailyChecklistDraft) => DailyChecklistDraft) => void;
}

const PlanEditor = ({ draft, progress, updateDraft }: PlanEditorProps) => {
  const t = useTranslate();
  const [notesOpen, setNotesOpen] = useState(Boolean(draft.notes.trim()));
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="task-section-title">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="task-section-title" className="text-xl font-semibold">
            {t("daily-checklist.plan-title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.plan-description")}</p>
        </div>
        <SectionProgress completed={progress.planCompleted} total={progress.planTotal} label={t("daily-checklist.plan-progress")} />
      </div>

      <div className="divide-y divide-border/70">
        <fieldset className="space-y-3 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <legend className="text-sm font-medium">{t("daily-checklist.fields.must-win-tasks")}</legend>
              <p className="mt-1 text-xs text-muted-foreground">{t("daily-checklist.helpers.must-win-tasks")}</p>
            </div>
            {draft.mustWinTasks.length < MAX_DAILY_MUST_WIN_TASKS && (
              <Button
                type="button"
                variant="ghost"
                className="h-11 px-2 sm:h-8"
                onClick={() =>
                  updateDraft((current) => ({ ...current, mustWinTasks: [...current.mustWinTasks, createDailyChecklistTaskDraft()] }))
                }
              >
                <PlusIcon aria-hidden="true" />
                {t("daily-checklist.add-task")}
              </Button>
            )}
          </div>
          <div className="space-y-2" role="list">
            {draft.mustWinTasks.map((task, index) => (
              <div
                key={task.id}
                role="listitem"
                className="group flex min-h-12 items-center gap-2 rounded-lg border border-border bg-background px-3 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
              >
                <CircleIcon className="size-4 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                <Input
                  value={task.content}
                  aria-label={t("daily-checklist.task-number", { number: index + 1 })}
                  className="h-10 scroll-mt-24 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
                  maxLength={500}
                  placeholder={t("daily-checklist.placeholders.must-win-task")}
                  onChange={(event) =>
                    updateDraft((current) => ({
                      ...current,
                      mustWinTasks: current.mustWinTasks.map((item) =>
                        item.id === task.id ? { ...item, content: event.target.value } : item,
                      ),
                    }))
                  }
                />
                {(task.content.trim() || draft.mustWinTasks.length > 1) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 shrink-0 text-muted-foreground hover:text-destructive sm:size-8"
                    aria-label={t("daily-checklist.remove-task", { number: index + 1 })}
                    onClick={() =>
                      updateDraft((current) => ({
                        ...current,
                        mustWinTasks: current.mustWinTasks.filter((item) => item.id !== task.id),
                      }))
                    }
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2 py-6">
          <Label htmlFor="daily-first-task">{t("daily-checklist.fields.first-task")}</Label>
          <p className="text-xs text-muted-foreground">{t("daily-checklist.helpers.first-task")}</p>
          <Input
            id="daily-first-task"
            value={draft.firstTask}
            className="h-11 scroll-mt-24"
            maxLength={500}
            placeholder={t("daily-checklist.placeholders.first-task")}
            onChange={(event) => updateDraft((current) => ({ ...current, firstTask: event.target.value }))}
          />
        </div>

        <div className="space-y-2 py-6">
          <Label htmlFor="daily-if-then">{t("daily-checklist.fields.if-then")}</Label>
          <p className="text-xs text-muted-foreground">{t("daily-checklist.helpers.if-then")}</p>
          <Textarea
            id="daily-if-then"
            value={draft.ifThen}
            className="min-h-24 scroll-mt-24 resize-y"
            maxLength={1000}
            placeholder={t("daily-checklist.placeholders.if-then")}
            onChange={(event) => updateDraft((current) => ({ ...current, ifThen: event.target.value }))}
          />
        </div>

        <details open={notesOpen} className="group/notes pt-3" onToggle={(event) => setNotesOpen(event.currentTarget.open)}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-md text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
            {t("daily-checklist.fields.notes")}
            <ChevronRightIcon
              className="ml-auto size-4 transition-transform group-open/notes:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-2 pb-1">
            <Label htmlFor="daily-notes" className="sr-only">
              {t("daily-checklist.fields.notes")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("daily-checklist.helpers.notes")}</p>
            <Textarea
              id="daily-notes"
              value={draft.notes}
              className="min-h-24 scroll-mt-24 resize-y"
              maxLength={5000}
              placeholder={t("daily-checklist.placeholders.notes")}
              onChange={(event) => updateDraft((current) => ({ ...current, notes: event.target.value }))}
            />
          </div>
        </details>
      </div>
    </section>
  );
};

interface TaskResultListProps {
  draft: DailyChecklistDraft;
  progress: DailyChecklistProgress;
  readonly: boolean;
  savingTaskId?: string;
  onTaskCompletion?: (taskId: string, completed: boolean) => void;
}

const TaskResultList = ({ draft, progress, readonly, savingTaskId, onTaskCompletion }: TaskResultListProps) => {
  const t = useTranslate();
  const tasks = draft.mustWinTasks.filter((task) => task.content.trim());
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{t("daily-checklist.fields.must-win-tasks")}</h3>
        <span
          className={cn(
            "flex items-center gap-1 text-xs font-medium",
            progress.tasksAllCompleted ? "text-primary" : "text-muted-foreground",
          )}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {progress.tasksAllCompleted && <CheckCircle2Icon className="size-3.5" aria-hidden="true" />}
          {t("daily-checklist.task-progress", { completed: progress.tasksCompleted, total: progress.tasksTotal })}
        </span>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("daily-checklist.no-tasks")}</p>
      ) : (
        <div className="space-y-2" role="list">
          {tasks.map((task, index) => (
            <div
              key={task.id}
              role="listitem"
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
                task.completed ? "border-border bg-muted/30" : "border-border bg-background",
              )}
            >
              {readonly ? (
                task.completed ? (
                  <CheckCircle2Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                ) : (
                  <CircleIcon className="size-5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                )
              ) : (
                <Checkbox
                  checked={task.completed}
                  disabled={Boolean(savingTaskId)}
                  className="size-6"
                  aria-label={t(task.completed ? "daily-checklist.reopen-task" : "daily-checklist.complete-task", { task: task.content })}
                  onCheckedChange={(checked) => onTaskCompletion?.(task.id, checked)}
                />
              )}
              <span className={cn("min-w-0 flex-1 break-words text-sm", task.completed && "text-muted-foreground line-through")}>
                <span className="sr-only">{index + 1}. </span>
                {task.content}
              </span>
              {savingTaskId === task.id && <span className="text-xs text-muted-foreground">{t("daily-checklist.saving")}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface PlanExecutionProps extends TaskResultListProps {
  onEdit?: () => void;
}

const PlanExecution = ({ draft, progress, readonly, savingTaskId, onTaskCompletion, onEdit }: PlanExecutionProps) => {
  const t = useTranslate();
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="execution-title">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="execution-title" className="text-xl font-semibold">
            {t("daily-checklist.execution-title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.execution-description")}</p>
        </div>
        {!readonly && onEdit && (
          <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={onEdit}>
            <PencilIcon aria-hidden="true" />
            {t("daily-checklist.adjust-plan")}
          </Button>
        )}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.45fr)]">
        <div className="space-y-5">
          {draft.firstTask.trim() && (
            <div className="border-l-2 border-primary pl-4">
              <p className="text-xs font-medium text-muted-foreground">{t("daily-checklist.fields.first-task")}</p>
              <p className="mt-1 break-words text-lg font-semibold leading-7">{draft.firstTask}</p>
            </div>
          )}
          <TaskResultList
            draft={draft}
            progress={progress}
            readonly={readonly}
            savingTaskId={savingTaskId}
            onTaskCompletion={onTaskCompletion}
          />
        </div>

        <aside className="space-y-4">
          {draft.ifThen.trim() && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">{t("daily-checklist.if-then-reminder")}</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{draft.ifThen}</p>
            </div>
          )}
          {draft.notes.trim() && (
            <div className="rounded-lg border border-border bg-muted/20 p-4">
              <h3 className="text-sm font-semibold">{t("daily-checklist.fields.notes")}</h3>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{draft.notes}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};

interface ReflectionEditorProps {
  draft: DailyChecklistDraft;
  progress: DailyChecklistProgress;
  updateDraft: (update: (current: DailyChecklistDraft) => DailyChecklistDraft) => void;
}

const ReflectionEditor = ({ draft, progress, updateDraft }: ReflectionEditorProps) => {
  const t = useTranslate();
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="reflection-section-title">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="reflection-section-title" className="text-xl font-semibold">
            {t("daily-checklist.evening-reflection")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.evening-reflection-description")}</p>
        </div>
        <SectionProgress
          completed={progress.reflectionCompleted}
          total={progress.reflectionTotal}
          label={t("daily-checklist.reflection-progress")}
        />
      </div>

      <div className="mb-6 rounded-lg bg-muted/30 p-4">
        <p className="text-sm font-medium">
          {t("daily-checklist.reflection.task-result", { completed: progress.tasksCompleted, total: progress.tasksTotal })}
        </p>
        {draft.mustWinTasks.some((task) => task.content.trim() && !task.completed) && (
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {t("daily-checklist.reflection.unfinished-tasks", {
              tasks: draft.mustWinTasks
                .filter((task) => task.content.trim() && !task.completed)
                .map((task) => task.content.trim())
                .join(" · "),
            })}
          </p>
        )}
      </div>

      <div className="space-y-8">
        {reflectionGroups.map((group) => {
          const completed = group.fields.filter((field) => draft[field.key].trim()).length;
          return (
            <fieldset key={group.titleKey} className="space-y-5">
              <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-3">
                <div>
                  <legend className="font-semibold">{t(group.titleKey)}</legend>
                  <p className="mt-1 text-sm text-muted-foreground">{t(group.descriptionKey)}</p>
                </div>
                <span className="shrink-0 text-xs font-medium text-muted-foreground">
                  {completed}/{group.fields.length}
                </span>
              </div>
              {group.fields.map((field, index) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`daily-reflection-${field.key}`} className="flex items-start gap-2 leading-5">
                    {draft[field.key].trim() ? (
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    ) : (
                      <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
                    )}
                    <span>
                      <span className="sr-only">{index + 1}. </span>
                      {t(field.labelKey)}
                    </span>
                  </Label>
                  {field.key === "obstacleResponse" && draft.ifThen.trim() && (
                    <div className="rounded-lg border border-border bg-muted/20 p-3">
                      <p className="text-xs font-medium text-muted-foreground">{t("daily-checklist.if-then-reminder")}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{draft.ifThen}</p>
                    </div>
                  )}
                  <Textarea
                    id={`daily-reflection-${field.key}`}
                    value={draft[field.key]}
                    className="min-h-24 scroll-mt-24 resize-y"
                    maxLength={2000}
                    placeholder={t(field.placeholderKey)}
                    onChange={(event) => updateDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                </div>
              ))}
            </fieldset>
          );
        })}
      </div>
    </section>
  );
};

const ReflectionPrompt = ({ progress, onEdit }: { progress: DailyChecklistProgress; onEdit: () => void }) => {
  const t = useTranslate();
  const started = progress.reflectionCompleted > 0;
  return (
    <section className="rounded-xl border border-border bg-card p-5 sm:p-6" aria-labelledby="reflection-prompt-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="reflection-prompt-title" className="text-lg font-semibold">
            {t("daily-checklist.evening-reflection")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(started ? "daily-checklist.reflection.continue-description" : "daily-checklist.evening-reflection-description")}
          </p>
          <p className="mt-2 text-xs font-medium text-muted-foreground">
            {t("daily-checklist.reflection-progress-count", {
              completed: progress.reflectionCompleted,
              total: progress.reflectionTotal,
            })}
          </p>
        </div>
        <Button type="button" className="h-11 sm:h-9" onClick={onEdit}>
          {t(started ? "daily-checklist.continue-reflection" : "daily-checklist.start-reflection")}
        </Button>
      </div>
    </section>
  );
};

const PlannedReflectionNotice = () => {
  const t = useTranslate();
  return (
    <section className="rounded-xl border border-border bg-muted/20 p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{t("daily-checklist.evening-reflection")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.reflection.future-description")}</p>
    </section>
  );
};

interface ChecklistSummaryProps extends TaskResultListProps {
  onEditPlan?: () => void;
  onEditReflection?: () => void;
  onPlanNextDay?: () => void;
}

const ChecklistSummary = ({
  draft,
  progress,
  readonly,
  savingTaskId,
  onTaskCompletion,
  onEditPlan,
  onEditReflection,
  onPlanNextDay,
}: ChecklistSummaryProps) => {
  const t = useTranslate();
  const hasPlan = Boolean(draft.firstTask.trim() || draft.ifThen.trim() || progress.tasksTotal || draft.notes.trim());
  const hasReflection = progress.reflectionCompleted > 0;
  return (
    <div className="space-y-5">
      {hasPlan && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="summary-plan-title">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="summary-plan-title" className="text-xl font-semibold">
                {t("daily-checklist.result-title")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("daily-checklist.reflection.task-result", { completed: progress.tasksCompleted, total: progress.tasksTotal })}
              </p>
            </div>
            {!readonly && onEditPlan && (
              <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={onEditPlan}>
                <PencilIcon aria-hidden="true" />
                {t("daily-checklist.adjust-plan")}
              </Button>
            )}
          </div>
          {draft.firstTask.trim() && (
            <div className="mb-5 border-l-2 border-primary pl-4">
              <p className="text-xs font-medium text-muted-foreground">{t("daily-checklist.fields.first-task")}</p>
              <p className="mt-1 break-words text-lg font-semibold">{draft.firstTask}</p>
            </div>
          )}
          <TaskResultList
            draft={draft}
            progress={progress}
            readonly={readonly}
            savingTaskId={savingTaskId}
            onTaskCompletion={onTaskCompletion}
          />
          {(draft.ifThen.trim() || draft.notes.trim()) && (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {draft.ifThen.trim() && (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <h3 className="text-sm font-semibold">{t("daily-checklist.if-then-reminder")}</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{draft.ifThen}</p>
                </div>
              )}
              {draft.notes.trim() && (
                <div className="rounded-lg border border-border bg-muted/20 p-4">
                  <h3 className="text-sm font-semibold">{t("daily-checklist.fields.notes")}</h3>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{draft.notes}</p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {hasReflection && (
        <section className="rounded-xl border border-border bg-card p-4 sm:p-6" aria-labelledby="summary-reflection-title">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="summary-reflection-title" className="text-xl font-semibold">
                {t("daily-checklist.reflection-summary-title")}
              </h2>
            </div>
            {!readonly && (
              <div className="flex flex-wrap gap-2">
                {onEditReflection && (
                  <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={onEditReflection}>
                    <PencilIcon aria-hidden="true" />
                    {t("daily-checklist.edit-reflection")}
                  </Button>
                )}
                {onPlanNextDay && (
                  <Button type="button" className="h-11 sm:h-8" onClick={onPlanNextDay}>
                    {t("daily-checklist.plan-next-day")}
                    <ChevronRightIcon aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {reflectionGroups.map((group) => {
              const visibleFields = group.fields.filter((field) => draft[field.key].trim());
              if (visibleFields.length === 0) return null;
              return (
                <section key={group.titleKey} className="rounded-lg bg-muted/20 p-4">
                  <h3 className="font-semibold">{t(group.titleKey)}</h3>
                  <dl className="mt-4 space-y-4">
                    {visibleFields.map((field) => (
                      <div key={field.key}>
                        <dt className="text-xs font-medium text-muted-foreground">{t(field.labelKey)}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{draft[field.key]}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              );
            })}
          </div>
        </section>
      )}

      {!hasPlan && !hasReflection && <p className="py-10 text-center text-sm text-muted-foreground">{t("daily-checklist.empty-public")}</p>}
    </div>
  );
};

interface ChecklistEditorProps {
  checklist?: DailyChecklist;
  date: string;
  name: string;
  username: string;
  readonly: boolean;
  onDateChange?: (date: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export const ChecklistEditor = ({ checklist, date, name, username, readonly, onDateChange, onDirtyChange }: ChecklistEditorProps) => {
  const t = useTranslate();
  const { i18n } = useTranslation();
  const [draft, setDraft] = useState(() => dailyChecklistToDraft(checklist));
  const [savedDraft, setSavedDraft] = useState(draft);
  const [dirty, setDirty] = useState(false);
  const [editingSection, setEditingSection] = useState<EditingSection | undefined>(() =>
    !readonly && !getDailyChecklistProgress(draft, date).planReady ? "plan" : undefined,
  );
  const [savedAt, setSavedAt] = useState<Date | undefined>(() => (checklist?.updateTime ? timestampDate(checklist.updateTime) : undefined));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [savingTaskId, setSavingTaskId] = useState<string>();
  const upsert = useUpsertDailyChecklist(name);
  const deleteChecklist = useDeleteDailyChecklist(name);
  const progress = getDailyChecklistProgress(draft, date);
  const savedProgress = getDailyChecklistProgress(savedDraft, date);
  const taskControlsPendingId = upsert.isPending || dirty ? (savingTaskId ?? "__pending__") : undefined;

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const updateDraft = (update: (current: DailyChecklistDraft) => DailyChecklistDraft) => {
    setDraft(update);
    setDirty(true);
  };

  const saveDraft = async () => {
    if (readonly || !dirty) return;
    try {
      const saved = await upsert.mutateAsync(dailyChecklistFromDraft(name, date, draft));
      const nextSavedDraft = dailyChecklistToDraft(saved);
      setDraft(nextSavedDraft);
      setSavedDraft(nextSavedDraft);
      setSavedAt(saved.updateTime ? timestampDate(saved.updateTime) : new Date());
      setDirty(false);
      setEditingSection(undefined);
      toast.success(t("daily-checklist.saved"));
    } catch (error) {
      handleError(error, toast.error, { context: t("daily-checklist.save-error") });
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void saveDraft();
  };

  const discardEdits = () => {
    if (dirty && !window.confirm(t("daily-checklist.discard-confirm"))) return;
    setDraft(savedDraft);
    setDirty(false);
    setEditingSection(getDailyChecklistProgress(savedDraft, date).planReady ? undefined : "plan");
  };

  const handleShare = async () => {
    const path = `/u/${encodeURIComponent(username)}/daily-checklists/${date}`;
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).toString());
      toast.success(t("daily-checklist.link-copied"));
    } catch (error) {
      handleError(error, toast.error, { context: t("daily-checklist.copy-error") });
    }
  };

  const handleTaskCompletion = async (taskId: string, completed: boolean) => {
    if (readonly || dirty || upsert.isPending) return;
    const previousDraft = draft;
    const nextDraft = {
      ...draft,
      mustWinTasks: draft.mustWinTasks.map((task) => (task.id === taskId ? { ...task, completed } : task)),
    };
    setDraft(nextDraft);
    setSavingTaskId(taskId);
    try {
      const saved = await upsert.mutateAsync(dailyChecklistFromDraft(name, date, nextDraft));
      const nextSavedDraft = dailyChecklistToDraft(saved);
      setDraft(nextSavedDraft);
      setSavedDraft(nextSavedDraft);
      setSavedAt(saved.updateTime ? timestampDate(saved.updateTime) : new Date());
      setDirty(false);
    } catch (error) {
      setDraft(previousDraft);
      handleError(error, toast.error, { context: t("daily-checklist.task-save-error") });
    } finally {
      setSavingTaskId(undefined);
    }
  };

  const handleDeleteChecklist = async () => {
    try {
      await deleteChecklist.mutateAsync();
      const emptyDraft = dailyChecklistToDraft();
      setDraft(emptyDraft);
      setSavedDraft(emptyDraft);
      setSavedAt(undefined);
      setDirty(false);
      setEditingSection("plan");
      toast.success(t("daily-checklist.deleted"));
    } catch (error) {
      handleError(error, toast.error, { context: t("daily-checklist.delete-error") });
      throw error;
    }
  };

  const statusLabel = dirty
    ? t("daily-checklist.unsaved")
    : savedAt
      ? t("daily-checklist.saved-at", {
          time: savedAt.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
        })
      : t("daily-checklist.not-created");
  const canCancel = savedProgress.hasContent || progress.hasContent;
  const VisibilityIcon = draft.visibility === Visibility.PUBLIC ? Globe2Icon : LockIcon;
  const visibilityLabel = t(draft.visibility === Visibility.PUBLIC ? "daily-checklist.public" : "daily-checklist.private");
  const saveLabel =
    editingSection === "plan"
      ? t("daily-checklist.save-plan")
      : editingSection === "reflection"
        ? t(progress.reflectionComplete ? "daily-checklist.save-and-close" : "daily-checklist.save-reflection")
        : t("common.save");

  const content: ReactNode = readonly ? (
    <ChecklistSummary draft={savedDraft} progress={savedProgress} readonly />
  ) : editingSection === "plan" ? (
    <form onSubmit={handleSubmit}>
      <PlanEditor draft={draft} progress={progress} updateDraft={updateDraft} />
    </form>
  ) : editingSection === "reflection" ? (
    <div className="space-y-5">
      <PlanExecution draft={savedDraft} progress={savedProgress} readonly />
      <form onSubmit={handleSubmit}>
        <ReflectionEditor draft={draft} progress={progress} updateDraft={updateDraft} />
      </form>
    </div>
  ) : savedProgress.state === "closed" ? (
    <ChecklistSummary
      draft={draft}
      progress={progress}
      readonly={false}
      savingTaskId={taskControlsPendingId}
      onTaskCompletion={handleTaskCompletion}
      onEditPlan={() => setEditingSection("plan")}
      onEditReflection={() => setEditingSection("reflection")}
      onPlanNextDay={() => onDateChange?.(shiftDailyChecklistDate(date, 1))}
    />
  ) : savedProgress.planReady ? (
    <div className="space-y-5">
      <PlanExecution
        draft={draft}
        progress={progress}
        readonly={false}
        savingTaskId={taskControlsPendingId}
        onTaskCompletion={handleTaskCompletion}
        onEdit={() => setEditingSection("plan")}
      />
      {savedProgress.state === "planned" ? (
        <PlannedReflectionNotice />
      ) : (
        <ReflectionPrompt progress={savedProgress} onEdit={() => setEditingSection("reflection")} />
      )}
    </div>
  ) : (
    <section className="rounded-xl border border-border bg-card p-6 text-center">
      <h2 className="font-semibold">{t("daily-checklist.incomplete-plan-title")}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm text-muted-foreground">{t("daily-checklist.incomplete-plan-description")}</p>
      <Button type="button" className="mt-4 h-11 sm:h-9" onClick={() => setEditingSection("plan")}>
        {t("daily-checklist.continue-plan")}
      </Button>
    </section>
  );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 pb-20">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{t("daily-checklist.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatChecklistDate(date, i18n.language)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <ChecklistStateBadge state={savedProgress.state} />
            {savedProgress.tasksTotal > 0 && (
              <span className="text-xs font-medium text-muted-foreground">
                {t("daily-checklist.task-progress", {
                  completed: savedProgress.tasksCompleted,
                  total: savedProgress.tasksTotal,
                })}
              </span>
            )}
          </div>
        </div>

        {!readonly ? (
          <div className="flex items-center gap-2 md:hidden">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={t("daily-checklist.previous-day")}
              onClick={() => onDateChange?.(shiftDailyChecklistDate(date, -1))}
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Input
              type="date"
              value={date}
              aria-label={t("daily-checklist.choose-date")}
              className="h-11 min-w-36"
              onChange={(event) => isDailyChecklistDate(event.target.value) && onDateChange?.(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label={t("daily-checklist.next-day")}
              onClick={() => onDateChange?.(shiftDailyChecklistDate(date, 1))}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Globe2Icon className="size-3.5" aria-hidden="true" />
            {t("daily-checklist.public-view")}
          </div>
        )}
      </header>

      {!readonly && (
        <div className="z-10 grid gap-3 rounded-xl border border-border bg-background/95 p-3 shadow-sm backdrop-blur-md md:sticky md:top-3 md:flex md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11 text-muted-foreground sm:h-8"
                    aria-label={t("daily-checklist.visibility-label")}
                  />
                }
              >
                <VisibilityIcon aria-hidden="true" />
                {visibilityLabel}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" size="sm">
                <DropdownMenuRadioGroup
                  value={String(draft.visibility)}
                  onValueChange={(value) => updateDraft((current) => ({ ...current, visibility: Number(value) as Visibility }))}
                >
                  <DropdownMenuRadioItem value={String(Visibility.PRIVATE)}>{t("daily-checklist.private")}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value={String(Visibility.PUBLIC)}>{t("daily-checklist.public")}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                {checklist && !editingSection && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
                      {t("daily-checklist.delete")}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className={cn("text-xs", dirty ? "font-medium text-foreground" : "text-muted-foreground")}>{statusLabel}</span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {checklist && !dirty && draft.visibility === Visibility.PUBLIC && (
              <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={handleShare}>
                <Share2Icon aria-hidden="true" />
                {t("common.share")}
              </Button>
            )}
            {editingSection && canCancel && (
              <Button type="button" variant="ghost" className="h-11 sm:h-8" disabled={upsert.isPending} onClick={discardEdits}>
                {t("common.cancel")}
              </Button>
            )}
            {(editingSection || dirty) && (
              <Button type="button" className="h-11 sm:h-8" disabled={upsert.isPending || !dirty} onClick={() => void saveDraft()}>
                <SaveIcon aria-hidden="true" />
                {upsert.isPending ? t("daily-checklist.saving") : saveLabel}
              </Button>
            )}
          </div>
        </div>
      )}

      {content}

      {!readonly && date !== getLocalDateString() && (
        <Button type="button" variant="ghost" className="mx-auto h-11 md:hidden" onClick={() => onDateChange?.(getLocalDateString())}>
          {t("daily-checklist.today")}
        </Button>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("daily-checklist.delete-confirm-title")}
        description={t("daily-checklist.delete-confirm-description")}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        onConfirm={handleDeleteChecklist}
        confirmVariant="destructive"
      />
    </div>
  );
};

const DailyChecklistPage = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useParams<{ username?: string; date?: string }>();
  const [editorDirty, setEditorDirty] = useState(false);

  const isPublicRoute = Boolean(params.username && params.date);
  const username = params.username ?? currentUser?.username ?? "";
  const requestedDate = params.date ?? searchParams.get("date");
  const validRequestedDate = isDailyChecklistDate(requestedDate) ? requestedDate : undefined;
  const date = validRequestedDate ?? getLocalDateString();
  const name = username && (!isPublicRoute || validRequestedDate) ? `users/${username}/dailyChecklists/${date}` : "";
  const query = useDailyChecklist(name);
  const readonly = isPublicRoute;
  const blocker = useBlocker(editorDirty && !readonly);

  const handleDateChange = (nextDate: string) =>
    navigate({ pathname: ROUTES.DAILY_CHECKLIST, search: new URLSearchParams({ date: nextDate }).toString() });

  let content: ReactNode;
  if (isPublicRoute && !validRequestedDate) {
    content = (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center gap-2 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t("daily-checklist.not-found")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t("daily-checklist.not-found-description")}</p>
      </div>
    );
  } else if (!name || query.isPending) {
    content = (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl items-center justify-center text-sm text-muted-foreground">
        {t("daily-checklist.loading")}
      </div>
    );
  } else if (query.isError) {
    content = (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center gap-3 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t("daily-checklist.load-error")}</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()}>
          {t("daily-checklist.retry")}
        </Button>
      </div>
    );
  } else if (readonly && !query.data) {
    content = (
      <div className="mx-auto flex min-h-72 w-full max-w-5xl flex-col items-center justify-center gap-2 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t("daily-checklist.not-found")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t("daily-checklist.not-found-description")}</p>
      </div>
    );
  } else {
    content = (
      <ChecklistEditor
        key={`${name}:${readonly ? "read" : date}`}
        checklist={query.data ?? undefined}
        date={date}
        name={name}
        username={username}
        readonly={readonly}
        onDateChange={readonly ? undefined : handleDateChange}
        onDirtyChange={setEditorDirty}
      />
    );
  }

  return (
    <>
      {content}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => !open && blocker.state === "blocked" && blocker.reset()}
        title={t("daily-checklist.discard-confirm-title")}
        description={t("daily-checklist.discard-confirm")}
        confirmLabel={t("daily-checklist.discard")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
        confirmVariant="destructive"
      />
    </>
  );
};

export default DailyChecklistPage;
