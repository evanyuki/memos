import { beforeEach, describe, expect, it, vi } from "vitest";

const visitorIDPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("visitor ID", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("creates and persists a stable anonymous identity", async () => {
    const { getVisitorID } = await import("@/utils/visitor-id");

    const visitorID = getVisitorID();

    expect(visitorID).toMatch(visitorIDPattern);
    expect(getVisitorID()).toBe(visitorID);
    expect(localStorage.getItem("memos-visitor-id")).toBe(visitorID);
  });

  it("replaces an invalid stored identity", async () => {
    localStorage.setItem("memos-visitor-id", "invalid");
    const { getVisitorID } = await import("@/utils/visitor-id");

    const visitorID = getVisitorID();

    expect(visitorID).toMatch(visitorIDPattern);
    expect(visitorID).not.toBe("invalid");
  });
});
