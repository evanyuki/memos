import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  CalendarCheck2Icon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  Globe2Icon,
  LockIcon,
  PlusIcon,
  SaveIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useDailyChecklist, useUpsertDailyChecklist } from "@/hooks/useDailyChecklistQueries";
import {
  createDailyChecklistTaskDraft,
  type DailyChecklistDraft,
  dailyChecklistFromDraft,
  dailyChecklistToDraft,
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

interface ReflectionField {
  key: keyof Pick<
    DailyChecklistDraft,
    "mostEffectiveAction" | "biggestObstacle" | "obstacleResponse" | "keepForTomorrow" | "removeForTomorrow" | "firstTaskTomorrow"
  >;
  labelKey: Translations;
}

const reflectionFields: ReflectionField[] = [
  { key: "mostEffectiveAction", labelKey: "daily-checklist.fields.most-effective-action" },
  { key: "biggestObstacle", labelKey: "daily-checklist.fields.biggest-obstacle" },
  { key: "obstacleResponse", labelKey: "daily-checklist.fields.obstacle-response" },
  { key: "keepForTomorrow", labelKey: "daily-checklist.fields.keep-for-tomorrow" },
  { key: "removeForTomorrow", labelKey: "daily-checklist.fields.remove-for-tomorrow" },
  { key: "firstTaskTomorrow", labelKey: "daily-checklist.fields.first-task-tomorrow" },
];

const formatChecklistDate = (date: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );

interface ChecklistEditorProps {
  checklist?: DailyChecklist;
  date: string;
  name: string;
  username: string;
  readonly: boolean;
  onDateChange?: (date: string) => void;
}

const ChecklistEditor = ({ checklist, date, name, username, readonly, onDateChange }: ChecklistEditorProps) => {
  const t = useTranslate();
  const [draft, setDraft] = useState(() => dailyChecklistToDraft(checklist));
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | undefined>(() => (checklist?.updateTime ? timestampDate(checklist.updateTime) : undefined));
  const upsert = useUpsertDailyChecklist(name);

  useEffect(() => {
    if (!dirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const updateDraft = (update: (current: DailyChecklistDraft) => DailyChecklistDraft) => {
    setDraft(update);
    setDirty(true);
  };

  const requestDateChange = (nextDate: string) => {
    if (!onDateChange || nextDate === date) return;
    if (dirty && !window.confirm(t("daily-checklist.discard-confirm"))) return;
    onDateChange(nextDate);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (readonly) return;
    try {
      const saved = await upsert.mutateAsync(dailyChecklistFromDraft(name, date, draft));
      setDraft(dailyChecklistToDraft(saved));
      setSavedAt(saved.updateTime ? timestampDate(saved.updateTime) : new Date());
      setDirty(false);
      toast.success(t("daily-checklist.saved"));
    } catch (error) {
      handleError(error, toast.error, { context: t("daily-checklist.save-error") });
    }
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

  const completedTasks = draft.mustWinTasks.filter((task) => task.content.trim() && task.completed).length;
  const totalTasks = draft.mustWinTasks.filter((task) => task.content.trim()).length;
  const visibleTasks = readonly ? draft.mustWinTasks.filter((task) => task.content.trim()) : draft.mustWinTasks;
  const statusLabel = dirty
    ? t("daily-checklist.unsaved")
    : savedAt
      ? t("daily-checklist.saved-at", { time: savedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) })
      : t("daily-checklist.not-created");

  return (
    <form onSubmit={handleSave} className="mx-auto flex w-full max-w-6xl flex-col gap-5 pb-16">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
            <CalendarCheck2Icon className="size-4" aria-hidden="true" />
            <span>{t("daily-checklist.eyebrow")}</span>
          </div>
          <h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">{t("daily-checklist.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{formatChecklistDate(date)}</p>
        </div>

        {!readonly ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 sm:size-8"
              aria-label={t("daily-checklist.previous-day")}
              onClick={() => requestDateChange(shiftDailyChecklistDate(date, -1))}
            >
              <ChevronLeftIcon aria-hidden="true" />
            </Button>
            <Input
              type="date"
              value={date}
              aria-label={t("daily-checklist.choose-date")}
              className="h-11 w-auto min-w-36 sm:h-8"
              onChange={(event) => isDailyChecklistDate(event.target.value) && requestDateChange(event.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 sm:size-8"
              aria-label={t("daily-checklist.next-day")}
              onClick={() => requestDateChange(shiftDailyChecklistDate(date, 1))}
            >
              <ChevronRightIcon aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" className="h-11 sm:h-8" onClick={() => requestDateChange(getLocalDateString())}>
              {t("daily-checklist.today")}
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
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <div
            className="flex min-w-0 items-center gap-1 rounded-lg bg-muted p-1"
            role="group"
            aria-label={t("daily-checklist.visibility-label")}
          >
            {[
              { value: Visibility.PRIVATE, label: t("daily-checklist.private"), icon: LockIcon },
              { value: Visibility.PUBLIC, label: t("daily-checklist.public"), icon: Globe2Icon },
            ].map((option) => {
              const Icon = option.icon;
              const selected = draft.visibility === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => updateDraft((current) => ({ ...current, visibility: option.value }))}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <span className={cn("text-xs", dirty ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
              {statusLabel}
            </span>
            {checklist && !dirty && draft.visibility === Visibility.PUBLIC && (
              <Button type="button" variant="outline" className="h-11 sm:h-8" onClick={handleShare}>
                <Share2Icon aria-hidden="true" />
                {t("common.share")}
              </Button>
            )}
            <Button type="submit" className="h-11 sm:h-8" disabled={upsert.isPending || !dirty}>
              <SaveIcon aria-hidden="true" />
              {upsert.isPending ? t("daily-checklist.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
        <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6" aria-labelledby="task-section-title">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">01</p>
              <h2 id="task-section-title" className="mt-1 text-lg font-semibold">
                {t("daily-checklist.task-section")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.task-section-description")}</p>
            </div>
            <div className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {t("daily-checklist.task-progress", { completed: completedTasks, total: totalTasks })}
            </div>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="daily-first-task">{t("daily-checklist.fields.first-task")}</Label>
              <Input
                id="daily-first-task"
                value={draft.firstTask}
                readOnly={readonly}
                className="h-11"
                placeholder={readonly ? undefined : t("daily-checklist.placeholders.first-task")}
                onChange={(event) => updateDraft((current) => ({ ...current, firstTask: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="daily-if-then">{t("daily-checklist.fields.if-then")}</Label>
              <Textarea
                id="daily-if-then"
                value={draft.ifThen}
                readOnly={readonly}
                className="min-h-24 resize-y"
                placeholder={readonly ? undefined : t("daily-checklist.placeholders.if-then")}
                onChange={(event) => updateDraft((current) => ({ ...current, ifThen: event.target.value }))}
              />
            </div>

            <fieldset className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <legend className="text-sm font-medium">{t("daily-checklist.fields.must-win-tasks")}</legend>
                {!readonly && (
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
                {visibleTasks.length === 0 && <p className="py-2 text-sm text-muted-foreground">{t("daily-checklist.no-tasks")}</p>}
                {visibleTasks.map((task, index) => (
                  <div
                    key={task.id}
                    role="listitem"
                    className="group flex min-h-12 items-center gap-2 rounded-lg border border-border/80 bg-background px-3 py-1.5"
                  >
                    <Checkbox
                      checked={task.completed}
                      disabled={readonly || !task.content.trim()}
                      className="size-5"
                      aria-label={t("daily-checklist.complete-task", { task: task.content || index + 1 })}
                      onCheckedChange={(checked) =>
                        updateDraft((current) => ({
                          ...current,
                          mustWinTasks: current.mustWinTasks.map((item) => (item.id === task.id ? { ...item, completed: checked } : item)),
                        }))
                      }
                    />
                    <Input
                      value={task.content}
                      readOnly={readonly}
                      aria-label={t("daily-checklist.task-number", { number: index + 1 })}
                      className={cn(
                        "h-9 border-0 px-1 shadow-none focus-visible:ring-0",
                        task.completed && "text-muted-foreground line-through",
                      )}
                      placeholder={readonly ? undefined : t("daily-checklist.placeholders.must-win-task")}
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          mustWinTasks: current.mustWinTasks.map((item) =>
                            item.id === task.id ? { ...item, content: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                    {!readonly && draft.mustWinTasks.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-10 text-muted-foreground hover:text-destructive sm:size-8 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
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

            <div className="space-y-2">
              <Label htmlFor="daily-notes">{t("daily-checklist.fields.notes")}</Label>
              <Textarea
                id="daily-notes"
                value={draft.notes}
                readOnly={readonly}
                className="min-h-28 resize-y"
                placeholder={readonly ? undefined : t("daily-checklist.placeholders.notes")}
                onChange={(event) => updateDraft((current) => ({ ...current, notes: event.target.value }))}
              />
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-4 shadow-xs sm:p-6" aria-labelledby="reflection-section-title">
          <div className="mb-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">02</p>
            <h2 id="reflection-section-title" className="mt-1 text-lg font-semibold">
              {t("daily-checklist.evening-reflection")}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("daily-checklist.evening-reflection-description")}</p>
          </div>

          <div className="space-y-5">
            {reflectionFields.map((field, index) => (
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
                <Textarea
                  id={`daily-reflection-${field.key}`}
                  value={draft[field.key]}
                  readOnly={readonly}
                  className="min-h-20 resize-y"
                  onChange={(event) => updateDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            ))}
          </div>
        </section>
      </div>
    </form>
  );
};

const DailyChecklistPage = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const params = useParams<{ username?: string; date?: string }>();

  const isPublicRoute = Boolean(params.username && params.date);
  const username = params.username ?? currentUser?.username ?? "";
  const requestedDate = params.date ?? searchParams.get("date");
  const validRequestedDate = isDailyChecklistDate(requestedDate) ? requestedDate : undefined;
  const date = validRequestedDate ?? getLocalDateString();
  const name = username && (!isPublicRoute || validRequestedDate) ? `users/${username}/dailyChecklists/${date}` : "";
  const query = useDailyChecklist(name);
  const readonly = isPublicRoute;

  const dateSearch = useMemo(() => new URLSearchParams({ date }).toString(), [date]);
  const handleDateChange = (nextDate: string) => navigate(`${ROUTES.DAILY_CHECKLIST}?${new URLSearchParams({ date: nextDate })}`);

  if (isPublicRoute && !validRequestedDate) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-6xl flex-col items-center justify-center gap-2 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t("daily-checklist.not-found")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t("daily-checklist.not-found-description")}</p>
      </div>
    );
  }

  if (!name || query.isPending) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-6xl items-center justify-center text-sm text-muted-foreground">
        {t("daily-checklist.loading")}
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-6xl flex-col items-center justify-center gap-3 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <p className="font-medium">{t("daily-checklist.load-error")}</p>
        <Button type="button" variant="outline" onClick={() => query.refetch()}>
          {t("daily-checklist.retry")}
        </Button>
      </div>
    );
  }

  if (readonly && !query.data) {
    return (
      <div className="mx-auto flex min-h-72 w-full max-w-6xl flex-col items-center justify-center gap-2 text-center">
        <CalendarCheck2Icon className="size-8 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{t("daily-checklist.not-found")}</h1>
        <p className="max-w-md text-sm text-muted-foreground">{t("daily-checklist.not-found-description")}</p>
      </div>
    );
  }

  return (
    <ChecklistEditor
      key={`${name}:${readonly ? "read" : dateSearch}`}
      checklist={query.data}
      date={date}
      name={name}
      username={username}
      readonly={readonly}
      onDateChange={readonly ? undefined : handleDateChange}
    />
  );
};

export default DailyChecklistPage;
