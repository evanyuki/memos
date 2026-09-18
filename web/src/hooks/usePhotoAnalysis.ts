import { useQuery } from "@tanstack/react-query";
import { analyzePreviewPixels, type PhotoAnalysis } from "@/components/Gallery/preview-colors";
import { useAuth } from "@/contexts/AuthContext";

function loadPhotoAnalysis(src: string, signal: AbortSignal): Promise<PhotoAnalysis> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      image.src = "";
      reject(new DOMException("Photo analysis cancelled", "AbortError"));
    };

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    image.onload = () => {
      try {
        if (signal.aborted) return;
        if (!image.naturalWidth || !image.naturalHeight) throw new Error("Image dimensions unavailable");
        const scale = Math.min(1, 256 / image.naturalWidth, 256 / image.naturalHeight);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.floor(image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
        if (!context) throw new Error("Canvas unavailable");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const analysis = analyzePreviewPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
        if (!analysis) throw new Error("No visible image pixels");
        resolve(analysis);
      } catch (error) {
        reject(error);
      } finally {
        cleanup();
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error("Unable to load photo analysis"));
    };
    image.crossOrigin = "anonymous";
    image.referrerPolicy = "no-referrer";
    image.src = src;
  });
}

export function usePhotoAnalysis(src: string | undefined, enabled = true) {
  const { currentUser, isInitialized } = useAuth();
  const activeSource = enabled && isInitialized ? src : undefined;
  return useQuery({
    queryKey: ["photo-analysis", currentUser?.name ?? "guest", activeSource ?? ""],
    queryFn: ({ signal }) => loadPhotoAnalysis(activeSource!, signal),
    enabled: !!activeSource,
    staleTime: Infinity,
    gcTime: 5 * 60 * 1000,
    retry: false,
  });
}
