import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/connect", () => ({ memoServiceClient: {} }));

import { getShareUrl } from "@/hooks/useMemoShareQueries";
import { MemoShareSchema } from "@/types/proto/api/v1/memo_service_pb";
import { isPublicRoute, shouldGatePrivateInstance } from "@/utils/redirect-safety";

describe("gallery share entry points", () => {
  it("opens the selected photo using the existing memo share token", () => {
    const share = create(MemoShareSchema, { name: "memos/memo-a/shares/token-a" });
    const url = new URL(getShareUrl(share, "photo-a"));

    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/gallery/photos/photo-a");
    expect(url.searchParams.get("share_token")).toBe("token-a");
    expect(getShareUrl(share)).toBe(`${window.location.origin}/memos/shares/token-a`);
  });

  it("lets a private-instance share reach server-side validation", () => {
    expect(
      shouldGatePrivateInstance({
        isPrivateInstance: true,
        isAuthenticated: false,
        pathname: "/gallery/photos/photo-a",
        search: "?share_token=token-a",
      }),
    ).toBe(false);
  });

  it.each([
    ["/gallery", "?share_token=token-a"],
    ["/gallery/photos/photo-a", ""],
    ["/gallery/photos/photo-a", "?share_token="],
    ["/gallery/photos/photo-a/extra", "?share_token=token-a"],
  ])("keeps private-instance sign-in protection for %s with %s", (pathname, search) => {
    expect(shouldGatePrivateInstance({ isPrivateInstance: true, isAuthenticated: false, pathname, search })).toBe(true);
  });

  it("recognizes public gallery entry routes without matching unrelated paths", () => {
    expect(isPublicRoute("/gallery")).toBe(true);
    expect(isPublicRoute("/gallery/photos/photo-a")).toBe(true);
    expect(isPublicRoute("/gallery-administration")).toBe(false);
    expect(isPublicRoute("/gallery/photos/photo-a/edit")).toBe(false);
  });
});
