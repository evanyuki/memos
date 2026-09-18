import { ArrowLeftIcon, FilterIcon, SearchIcon } from "lucide-react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { readGalleryFilters } from "@/hooks/useGalleryQueries";
import { cn } from "@/lib/utils";
import { useTranslate } from "@/utils/i18n";
import GalleryLinearBlur from "./GalleryLinearBlur";

export default function GalleryPageHeader({ photoCount }: { photoCount: number }) {
  const t = useTranslate();
  const { currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const filters = readGalleryFilters(params);
  const visibilityOptions = currentUser ? (["ALL", "PUBLIC", "PRIVATE", "PROTECTED"] as const) : (["ALL", "PUBLIC"] as const);
  const active = filters.visibility !== "ALL" || !!filters.tag || filters.state === "ARCHIVED";
  const updateFilter = (key: string, value: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        value ? next.set(key, value) : next.delete(key);
        return next;
      },
      { replace: true },
    );
  };
  const submitTag = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    updateFilter(
      "tag",
      String(new FormData(event.currentTarget).get("tag") ?? "")
        .trim()
        .replace(/^#/, ""),
    );
  };

  return (
    <header className="gallery-page-header fixed inset-x-0 top-0 z-30" aria-label={t("gallery.title")}>
      <GalleryLinearBlur />
      <div className="relative flex h-12 items-center justify-between gap-2 px-3 lg:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link to="/" aria-label={t("common.home")} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
            <ArrowLeftIcon className="size-4" />
          </Link>
          <h1 className="truncate text-sm font-semibold">{t("gallery.title")}</h1>
          <span className="text-xs tabular-nums text-muted-foreground">{photoCount}</span>
        </div>
        <div className="flex items-center gap-2">
          {filters.tag && (
            <span className="max-w-32 truncate text-xs text-muted-foreground" title={filters.tag}>
              #{filters.tag}
            </span>
          )}
          <Popover>
            <PopoverTrigger
              className={cn(buttonVariants({ variant: active ? "secondary" : "ghost", size: "icon-sm" }), "size-8 rounded-lg")}
              aria-label={t("common.filter")}
            >
              <FilterIcon className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" className="gallery-theme gallery-page-header-popover w-72 space-y-4 rounded-xl p-3 shadow-none">
              <fieldset className="space-y-2">
                <legend className="text-xs text-muted-foreground">{t("gallery.visibility")}</legend>
                <div className="flex gap-1">
                  {visibilityOptions.map((visibility) => (
                    <Button
                      key={visibility}
                      variant={filters.visibility === visibility ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 flex-1 rounded-md px-2 text-xs"
                      aria-pressed={filters.visibility === visibility}
                      onClick={() => updateFilter("visibility", visibility === "ALL" ? "" : visibility)}
                    >
                      {t(
                        `gallery.visibility-${visibility === "ALL" ? "all" : visibility === "PUBLIC" ? "public" : visibility === "PRIVATE" ? "private" : "protected"}`,
                      )}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <form className="flex items-center gap-1" onSubmit={submitTag}>
                <Input
                  key={filters.tag}
                  name="tag"
                  defaultValue={filters.tag}
                  placeholder={t("gallery.filter-tag")}
                  aria-label={t("gallery.filter-tag")}
                  className="h-8 min-w-0 text-xs"
                />
                <Button type="submit" variant="ghost" size="icon-sm" aria-label={t("common.search")}>
                  <SearchIcon className="size-4" />
                </Button>
              </form>
              {currentUser && (
                <Button
                  variant={filters.state === "ARCHIVED" ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 w-full text-xs"
                  aria-pressed={filters.state === "ARCHIVED"}
                  onClick={() => updateFilter("state", filters.state === "ARCHIVED" ? "" : "ARCHIVED")}
                >
                  {t("common.archived")}
                </Button>
              )}
              {active && (
                <Button variant="ghost" size="sm" className="h-7 w-full text-xs" onClick={() => setParams({}, { replace: true })}>
                  {t("common.clear")}
                </Button>
              )}
            </PopoverContent>
          </Popover>
          {currentUser && (
            <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-8 text-xs")}>
              {t("gallery.add-photos")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
