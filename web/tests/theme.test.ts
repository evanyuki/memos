import { beforeEach, describe, expect, it } from "vitest";
import { applyThemeEarly, DEFAULT_THEME, getInitialTheme, getThemeWithFallback, loadTheme } from "@/utils/theme";

describe("default theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
    document.getElementById("instance-theme")?.remove();
  });

  it("uses the dark theme when no preference exists", () => {
    expect(DEFAULT_THEME).toBe("default-dark");
    expect(getInitialTheme()).toBe("default-dark");
    expect(getThemeWithFallback()).toBe("default-dark");

    applyThemeEarly();

    expect(document.documentElement.dataset.theme).toBe("default-dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("preserves a locally saved light theme", () => {
    loadTheme("default");

    expect(getInitialTheme()).toBe("default");
    expect(getThemeWithFallback()).toBe("default");
  });

  it("gives an explicit user setting priority over local storage", () => {
    loadTheme("default");

    expect(getThemeWithFallback("paper")).toBe("paper");
    expect(getThemeWithFallback("system")).toBe("system");
  });
});
