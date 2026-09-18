import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GallerySharePanel from "@/components/Gallery/GallerySharePanel";
import MemoSharePanel from "@/components/MemoDetailSidebar/MemoSharePanel";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema, MemoShareSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const { auth, listShares, createShare, deleteShare } = vi.hoisted(() => ({
  auth: { currentUser: { name: "users/owner" } },
  listShares: vi.fn(),
  createShare: vi.fn(),
  deleteShare: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePhotoAnalysis", () => ({ usePhotoAnalysis: () => ({ data: undefined }) }));
vi.mock("@/utils/i18n", () => ({ useTranslate: () => (key: string) => key }));
vi.mock("@/hooks/useMemoShareQueries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useMemoShareQueries")>()),
  useMemoShares: listShares,
  useCreateMemoShare: () => ({ mutateAsync: createShare, isPending: false }),
  useDeleteMemoShare: () => ({ mutateAsync: deleteShare, isPending: false }),
}));

const attachment = create(AttachmentSchema, { name: "attachments/photo2", filename: "Night.jpg", type: "image/jpeg" });
const memo = create(MemoSchema, { name: "memos/note", creator: "users/owner", visibility: Visibility.PRIVATE, attachments: [attachment] });
const share = create(MemoShareSchema, { name: "memos/note/shares/token" });

beforeEach(() => {
  auth.currentUser = { name: "users/owner" };
  listShares.mockReturnValue({ data: [share], isLoading: false });
  createShare.mockResolvedValue(share);
  deleteShare.mockResolvedValue(undefined);
});

describe("gallery sharing", () => {
  it("previews the selected thumbnail and keeps photo routes for existing share links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Night" })).toHaveAttribute(
      "src",
      `${window.location.origin}/file/attachments/photo2/Night.jpg?thumbnail=true`,
    );
    fireEvent.click(screen.getByRole("button", { name: "memo.share.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/gallery/photos/photo2?share_token=token`));
    fireEvent.click(screen.getByRole("button", { name: "memo.share.create-link" }));
    await waitFor(() => expect(createShare).toHaveBeenCalledWith({ memoName: memo.name, expireTime: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "memo.share.revoke" }));
    await waitFor(() => expect(deleteShare).toHaveBeenCalledWith({ name: share.name, memoName: memo.name }));
    expect(screen.queryByRole("button", { name: "gallery.copy-link" })).not.toBeInTheDocument();
  });

  it("does not fetch or offer managed share links to public readers", () => {
    auth.currentUser = { name: "users/reader" };
    render(<GallerySharePanel photo={{ attachment, memo: { ...memo, visibility: Visibility.PUBLIC } }} onClose={vi.fn()} />);
    expect(screen.getByRole("img", { name: "Night" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "gallery.copy-link" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "memo.share.create-link" })).not.toBeInTheDocument();
    expect(listShares).not.toHaveBeenCalled();
  });

  it("can retry a failed thumbnail without losing sharing controls", () => {
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.error(screen.getByRole("img", { name: "Night" }));
    expect(screen.getByRole("status")).toHaveTextContent("gallery.preview-error");
    fireEvent.click(screen.getByRole("button", { name: "gallery.retry" }));
    const preview = screen.getByRole("img", { name: "Night" });
    expect(preview.parentElement).toHaveAttribute("aria-busy", "true");
    fireEvent.load(preview);
    expect(preview.parentElement).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "memo.share.create-link" })).toBeEnabled();
  });

  it("preserves the standard memo sharing dialog and its memo-scoped links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MemoSharePanel open memoName={memo.name} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "memo.share.title" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "memo.share.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/memos/shares/token`));
  });
});
