import { LoaderCircleIcon } from "lucide-react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import GalleryPhotoView from "@/components/Gallery/GalleryPhotoView";
import { Button } from "@/components/ui/button";
import { readGalleryFilters, useGalleryPhoto } from "@/hooks/useGalleryQueries";
import { useTranslate } from "@/utils/i18n";

export default function GalleryPhoto() {
  const t = useTranslate();
  const { uid = "" } = useParams();
  const [params] = useSearchParams();
  const shareToken = params.get("share_token") ?? undefined;
  const location = useLocation();
  const query = useGalleryPhoto(uid, shareToken, location.state?.galleryReturn ? readGalleryFilters(params) : undefined);
  if (query.isPending)
    return (
      <div role="status" className="flex min-h-svh flex-col items-center justify-center gap-4">
        <LoaderCircleIcon className="size-6 animate-spin" aria-label={t("resource.fetching-data")} />
        <Link to="/gallery" className="text-sm underline">
          {t("gallery.title")}
        </Link>
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div role="alert" className="flex flex-col items-center gap-4 px-6 py-20 text-center">
        <p className="text-muted-foreground">{t("gallery.photo-unavailable")}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          {t("gallery.retry")}
        </Button>
        <Link to="/gallery" className="text-sm underline">
          {t("gallery.title")}
        </Link>
      </div>
    );
  return <GalleryPhotoView key={uid} photo={query.data} shareToken={shareToken} loadingDetails={query.isPlaceholderData} />;
}
