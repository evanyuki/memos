import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mediaMetadataService } from "@/components/MemoEditor/services/mediaMetadataService";

describe("mediaMetadataService", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:test-media"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("reads video dimensions and duration and revokes the object URL", async () => {
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() !== "video") return element;
      Object.defineProperties(element, {
        videoWidth: { configurable: true, value: 1920 },
        videoHeight: { configurable: true, value: 1080 },
        duration: { configurable: true, value: 12.5 },
      });
      vi.spyOn(element as HTMLVideoElement, "load").mockImplementation(() => {
        queueMicrotask(() => element.dispatchEvent(new Event("loadedmetadata")));
      });
      return element;
    });

    const metadata = await mediaMetadataService.extract(new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" }));

    expect(metadata?.width).toBe(1920);
    expect(metadata?.height).toBe(1080);
    expect(metadata?.details.case).toBe("video");
    if (metadata?.details.case !== "video") throw new Error("expected video metadata");
    expect(metadata.details.value.durationSeconds).toBe(12.5);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-media");
  });

  it("times out video extraction, revokes the object URL, and returns no metadata", async () => {
    vi.useFakeTimers();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = createElement(tagName, options);
      if (tagName.toLowerCase() === "video") {
        vi.spyOn(element as HTMLVideoElement, "load").mockImplementation(() => undefined);
      }
      return element;
    });

    const extraction = mediaMetadataService.extract(new File([new Uint8Array([1])], "clip.mp4", { type: "video/mp4" }));
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(extraction).resolves.toBeUndefined();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-media");
  });

  it("ignores non-media files", async () => {
    const metadata = await mediaMetadataService.extract(new File(["hello"], "notes.txt", { type: "text/plain" }));

    expect(metadata).toBeUndefined();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
