import { create } from "@bufbuild/protobuf";
import { type MediaMetadata, MediaMetadataSchema, VideoMetadataSchema } from "@/types/proto/api/v1/attachment_service_pb";

const EXTRACTION_TIMEOUT_MS = 5_000;
type Dimensions = { width: number; height: number };

export const mediaMetadataService = {
  async extract(file: File): Promise<MediaMetadata | undefined> {
    if (!file.type.startsWith("video/")) return undefined;
    try {
      return await extractVideoMetadata(file);
    } catch {
      return undefined;
    }
  },
};

async function extractVideoMetadata(file: File): Promise<MediaMetadata | undefined> {
  const { dimensions, durationSeconds } = await readVideoMetadata(file);
  if (!dimensions && durationSeconds === undefined) {
    return undefined;
  }

  return create(MediaMetadataSchema, {
    width: dimensions?.width,
    height: dimensions?.height,
    details:
      durationSeconds === undefined ? { case: undefined } : { case: "video", value: create(VideoMetadataSchema, { durationSeconds }) },
  });
}

async function readVideoMetadata(file: File): Promise<{ dimensions?: Dimensions; durationSeconds?: number }> {
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const cleanup = () => {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("error", fail);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };
    const fail = () => {
      cleanup();
      reject(new Error("video metadata extraction failed"));
    };
    const handleLoadedMetadata = () => {
      const dimensions = normalizeDimensions(video.videoWidth, video.videoHeight);
      const durationSeconds = Number.isFinite(video.duration) && video.duration >= 0 ? video.duration : undefined;
      cleanup();
      resolve({ dimensions, durationSeconds });
    };
    const timeout = window.setTimeout(fail, EXTRACTION_TIMEOUT_MS);

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("error", fail);
    video.src = url;
    video.load();
  });
}

function normalizeDimensions(width: number, height: number): Dimensions | undefined {
  return Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0 ? { width, height } : undefined;
}
