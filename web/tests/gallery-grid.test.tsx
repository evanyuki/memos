import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GalleryGrid from "@/components/Gallery/GalleryGrid";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const { result, auth, loadMore } = vi.hoisted(() => ({
  result: { data: undefined as unknown, isPending: false, isError: false, hasNextPage: true, isFetchingNextPage: false },
  auth: { currentUser: undefined as { name: string } | undefined, userTagsSetting: undefined },
  loadMore: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useGalleryQueries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useGalleryQueries")>();
  return { ...actual, useGalleryPhotos: () => ({ ...result, fetchNextPage: loadMore }) };
});
vi.mock("@/connect", () => ({ getRequestToken: vi.fn(), refreshAccessToken: vi.fn() }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));
vi.mock("@/hooks/useMediaQuery", () => ({ default: () => true }));
beforeAll(() => {
  Object.defineProperty(document.documentElement, "clientHeight", { configurable: true, value: 900 });
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1200 });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
function Location() {
  const location = useLocation();
  return <output data-testid="filter-url">{location.search}</output>;
}
function mount() {
  return render(
    <MemoryRouter initialEntries={["/gallery"]}>
      <GalleryGrid />
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(() => {
  result.data = undefined;
  result.isError = false;
  auth.currentUser = undefined;
  loadMore.mockResolvedValue(undefined);
});

describe("gallery grid", () => {
  it("uses one filter popover and a route back to Memos", async () => {
    mount();
    expect(screen.getByRole("link", { name: "common.home" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("textbox", { name: "gallery.filter-tag" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.filter" }));
    await screen.findByRole("textbox", { name: "gallery.filter-tag" });
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });

  it("allows more pages after an empty memo page and omits upload/private filters for visitors", () => {
    mount();
    expect(screen.getByText("gallery.empty-page")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "memo.load-more" }));
    expect(loadMore).toHaveBeenCalledOnce();
    expect(screen.queryByRole("link", { name: "gallery.add-photos" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gallery.visibility-private" })).not.toBeInTheDocument();
  });
  it("stores visibility and exact hierarchical tags in URL filters", async () => {
    auth.currentUser = { name: "users/owner" };
    mount();
    fireEvent.click(screen.getByRole("button", { name: "common.filter" }));
    fireEvent.click(await screen.findByRole("button", { name: "gallery.visibility-protected" }));
    fireEvent.change(screen.getByRole("textbox", { name: "gallery.filter-tag" }), { target: { value: "#杭州/旅行" } });
    fireEvent.submit(screen.getByRole("textbox", { name: "gallery.filter-tag" }).closest("form")!);
    const params = new URLSearchParams(screen.getByTestId("filter-url").textContent!);
    expect(params.get("visibility")).toBe("PROTECTED");
    expect(params.get("tag")).toBe("杭州/旅行");
  });
  it("links photos by attachment identity and removes stale images on a failed permission refresh", async () => {
    result.data = {
      pages: [
        {
          photos: [
            {
              attachment: create(AttachmentSchema, { name: "attachments/stable-uid", filename: "Renamed.jpg" }),
              memo: create(MemoSchema, { visibility: Visibility.PUBLIC }),
            },
          ],
        },
      ],
    };
    const view = mount();
    expect(await screen.findByRole("link", { name: "Renamed.jpg" })).toHaveAttribute("href", "/gallery/photos/stable-uid");
    result.isError = true;
    view.rerender(
      <MemoryRouter>
        <GalleryGrid />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.queryByRole("img", { name: "Renamed.jpg" })).not.toBeInTheDocument());
  });
});
