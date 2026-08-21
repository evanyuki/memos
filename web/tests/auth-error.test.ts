import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";
import { isUnauthenticatedError } from "@/utils/auth-error";

describe("isUnauthenticatedError", () => {
  it("accepts confirmed unauthenticated responses", () => {
    expect(isUnauthenticatedError(new ConnectError("session expired", Code.Unauthenticated))).toBe(true);
  });

  it("rejects temporary backend failures", () => {
    expect(isUnauthenticatedError(new ConnectError("database unavailable", Code.Unavailable))).toBe(false);
    expect(isUnauthenticatedError(new ConnectError("database failed", Code.Internal))).toBe(false);
  });

  it("rejects non-Connect errors", () => {
    expect(isUnauthenticatedError(new Error("network failed"))).toBe(false);
  });
});
