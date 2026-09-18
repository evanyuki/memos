import { describe, expect, it } from "vitest";
import { analyzePreviewPixels } from "@/components/Gallery/preview-colors";

describe("gallery preview analysis", () => {
  it("keeps black and white luminance endpoints and ignores transparent pixels", () => {
    const result = analyzePreviewPixels(new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0]));
    expect(result.palette).toEqual(["#000000", "#ffffff"]);
    expect(result.histogram.luminance[0]).toBe(0.5);
    expect(result.histogram.luminance[255]).toBe(0.5);
    expect(result.histogram.luminance.reduce((a, b) => a + b, 0)).toBe(1);
  });
  it("ranks dominant buckets and returns their measured mean color", () => {
    const result = analyzePreviewPixels(new Uint8ClampedArray([250, 0, 0, 255, 240, 0, 0, 255, 0, 0, 255, 255]));
    expect(result.palette).toEqual(["#f50000", "#0000ff"]);
    expect(result.histogram.red[250]).toBeGreaterThan(0);
    expect(result.histogram.blue[255]).toBeGreaterThan(0);
  });
  it("matches the Lifemory tone thresholds for low and high key previews", () => {
    const lowKey = analyzePreviewPixels(new Uint8ClampedArray([10, 10, 10, 255, 20, 20, 20, 255]));
    const highKey = analyzePreviewPixels(new Uint8ClampedArray([240, 240, 240, 255, 250, 250, 250, 255]));
    expect(lowKey.toneAnalysis.toneType).toBe("low-key");
    expect(highKey.toneAnalysis.toneType).toBe("high-key");
  });
  it("returns unavailable for fully transparent previews", () => {
    expect(analyzePreviewPixels(new Uint8ClampedArray([255, 0, 0, 0]))).toBeNull();
  });
});
