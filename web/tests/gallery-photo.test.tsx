import { create } from "@bufbuild/protobuf";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GalleryPhotoView from "@/components/Gallery/GalleryPhotoView";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const { mutate, auth } = vi.hoisted(() => ({
  mutate: vi.fn(),
  auth: { currentUser: { name: "users/owner" }, userTagsSetting: undefined },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/useMediaQuery", () => ({ __esModule: true, default: () => false }));
vi.mock("@/hooks/useGalleryQueries", () => ({ galleryKeys: { all: ["gallery"] } }));
vi.mock("@/hooks/useMemoQueries", () => ({ useUpdateMemo: () => ({ mutateAsync: mutate }) }));
vi.mock("@/hooks/useMemoShareQueries", () => ({ withShareAttachmentLinks: (items: unknown) => items }));
vi.mock("@/components/MemoContent/MentionResolutionContext", () => ({
  MentionResolutionProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/MemoContent", () => ({ default: () => <p>Description</p> }));
vi.mock("@/components/MediaMetadataDetails", () => ({ default: () => <div>Metadata</div> }));
vi.mock("@/components/MemoDetailSidebar/MemoSharePanel", () => ({
  MemoShareLinks: ({ photoUID }: { photoUID: string }) => <div data-testid="share-links">{photoUID}</div>,
}));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));
const attachment = create(AttachmentSchema, { name: "attachments/photo1", filename: "Sunset.jpg", type: "image/jpeg" });
const second = create(AttachmentSchema, { name: "attachments/photo2", filename: "Night.jpg", type: "image/jpeg" });
function Location() {
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <output data-testid="location" data-navigation-type={navigationType}>
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(visibility = Visibility.PRIVATE, shareToken?: string, fromGallery = false) {
  const memo = create(MemoSchema, {
    name: "memos/note",
    creator: "users/owner",
    visibility,
    tags: ["travel"],
    attachments: [attachment, second],
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter
        initialEntries={
          fromGallery
            ? [
                "/gallery?tag=travel",
                {
                  pathname: "/gallery/photos/photo1",
                  search: "?tag=travel",
                  state: { galleryReturn: true, photoUids: ["photo1", "photo2"] },
                },
              ]
            : ["/gallery/photos/photo1?tag=travel"]
        }
      >
        <Routes>
          <Route path="/gallery/photos/:uid" element={<GalleryPhotoView photo={{ attachment, memo }} shareToken={shareToken} />} />
          <Route path="/gallery" element={<p>Gallery grid</p>} />
        </Routes>
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.currentUser = { name: "users/owner" };
  mutate.mockResolvedValue({});
});

describe("gallery photo detail", () => {
  it("returns to the original gallery history entry after navigating photos", () => {
    mount(Visibility.PRIVATE, undefined, true);
    fireEvent.click(screen.getByRole("button", { name: "gallery.next" }));
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery?tag=travel");
    expect(screen.getByTestId("location")).toHaveAttribute("data-navigation-type", "POP");
  });
  it("keeps navigation on the current photo while zoomed and restores it after zoom reset", () => {
    mount();
    fireEvent.doubleClick(screen.getByRole("img", { name: "Sunset.jpg" }));
    expect(screen.getByRole("button", { name: "gallery.next" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery/photos/photo1?tag=travel");
    fireEvent.doubleClick(screen.getByRole("img", { name: "Sunset.jpg" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery/photos/photo2?tag=travel");
  });
  it("copies the public permanent route for readers without creating a memo share", async () => {
    auth.currentUser = { name: "users/reader" };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    mount(Visibility.PUBLIC);
    fireEvent.click(screen.getByRole("button", { name: "common.share" }));
    expect(screen.getByRole("img", { name: "Sunset" })).toHaveAttribute(
      "src",
      `${window.location.origin}/file/attachments/photo1/Sunset.jpg?thumbnail=true`,
    );
    expect(writeText).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "gallery.copy-link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/gallery/photos/photo1`));
    expect(screen.queryByTestId("share-links")).not.toBeInTheDocument();
  });
  it("only updates the source memo after confirming the shared visibility scope", async () => {
    mount(Visibility.PROTECTED);
    fireEvent.click(screen.getByRole("button", { name: "attachment-details.actions.show" }));
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "gallery.visibility-public" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("gallery.visibility-scope");
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "common.confirm" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({ update: { name: "memos/note", visibility: Visibility.PUBLIC }, updateMask: ["visibility"] }),
    );
  });
  it("omits comments from the inspector and routes keyboard navigation to the next photo", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "attachment-details.actions.show" }));
    expect(screen.queryByRole("button", { name: "memo.comment.self" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "gallery.inspector-title" })).not.toBeInTheDocument());
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery/photos/photo2?tag=travel");
  });
  it("retains the photo in a private share and never exposes public-link or visibility actions", () => {
    mount();
    expect(screen.queryByRole("button", { name: "gallery.copy-link" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.share" }));
    expect(screen.getByTestId("share-links")).toHaveTextContent("photo1");
    expect(screen.getByRole("img", { name: "Sunset" })).toHaveAttribute(
      "src",
      `${window.location.origin}/file/attachments/photo1/Sunset.jpg?thumbnail=true`,
    );
    expect(screen.queryByRole("button", { name: "gallery.copy-link" })).not.toBeInTheDocument();
  });
  it("closes sharing before the viewer and ignores photo shortcuts inside the sharing dialog", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "common.share" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Sunset" }), { key: "ArrowRight" });
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery/photos/photo1?tag=travel");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Sunset" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("omits comments, editing and sharing for share-token readers", () => {
    mount(Visibility.PRIVATE, "token");
    expect(screen.queryByRole("button", { name: "common.share" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "attachment-details.actions.show" }));
    expect(screen.queryByRole("button", { name: "memo.comment.self" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gallery.visibility-public" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "gallery.open-memo" })).toHaveAttribute("href", "/memos/shares/token");
  });
  it("opens the photo route directly and closes to the filtered gallery", () => {
    mount();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "gallery.inspector-title" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "common.close" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/gallery?tag=travel");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("closes the viewer inspector before closing the viewer with Escape", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "attachment-details.actions.show" }));
    expect(screen.getByRole("heading", { name: "gallery.inspector-title" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "gallery.inspector-title" })).not.toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
