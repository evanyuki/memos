import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";
import {
  AttachmentSchema,
  MediaMetadataSchema,
  PhotoMetadataSchema,
  VideoMetadataSchema,
} from "@/types/proto/api/v1/attachment_service_pb";
import { buildMediaMetadataDisplay, formatExposureTime, formatMediaDuration } from "@/utils/media-metadata";

describe("media metadata display formatting", () => {
  it("uses conventional media duration and shutter-speed notation", () => {
    expect(formatMediaDuration(65.4)).toBe("1:05");
    expect(formatMediaDuration(3661)).toBe("1:01:01");
    expect(formatExposureTime(1 / 120, "en")).toBe("1/120 s");
  });

  it("formats video metadata without requiring photo details", () => {
    const attachment = create(AttachmentSchema, {
      filename: "clip.mp4",
      type: "video/mp4",
      size: 1_048_576n,
      mediaMetadata: create(MediaMetadataSchema, {
        width: 1920,
        height: 1080,
        details: {
          case: "video",
          value: create(VideoMetadataSchema, { durationSeconds: 12.5 }),
        },
      }),
    });

    expect(buildMediaMetadataDisplay([attachment], "en")).toMatchObject({
      file: "MP4 · 1.0 MB",
      dimensions: "1920 × 1080 px",
      duration: "0:13",
      hasSavedMetadata: true,
    });
  });
});

describe("professional photo metadata", () => {
  it("displays extracted color and exposure information without inventing missing values", () => {
    const attachment = create(AttachmentSchema, {
      mediaMetadata: create(MediaMetadataSchema, {
        details: {
          case: "photo",
          value: create(PhotoMetadataSchema, {
            colorSpace: "sRGB",
            iccProfile: "Display P3",
            bitsPerSample: 10,
            whiteBalance: "Manual",
            exposureBiasEv: 0,
            focalLength35mm: 50,
            exposureProgram: "Aperture priority",
            meteringMode: "Multi-segment",
          }),
        },
      }),
    });
    expect(buildMediaMetadataDisplay([attachment], "en")).toMatchObject({
      colorSpace: "sRGB",
      iccProfile: "Display P3",
      bitDepth: "10",
      whiteBalance: "Manual",
      exposureBias: "0 EV",
      focalLengthEquivalent: "50 mm",
      exposureProgram: "Aperture priority",
      meteringMode: "Multi-segment",
    });
    expect(buildMediaMetadataDisplay([create(AttachmentSchema)], "en").colorSpace).toBeUndefined();
  });
});
