import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GallerySharePanel from "@/components/Gallery/GallerySharePanel";
import MemoSharePanel from "@/components/MemoDetailSidebar/MemoSharePanel";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { MemoSchema, MemoShareSchema, Visibility } from "@/types/proto/api/v1/memo_service_pb";

const { auth, listShares, createShare, deleteShare, shareFile, downloadFile, toastError, toastSuccess } = vi.hoisted(() => ({
  auth: { currentUser: { name: "users/owner" } },
  listShares: vi.fn(),
  createShare: vi.fn(),
  deleteShare: vi.fn(),
  shareFile: vi.fn(),
  downloadFile: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock("react-hot-toast", () => ({
  default: { error: toastError, success: toastSuccess },
  toast: { error: toastError, success: toastSuccess },
}));
vi.mock("@/hooks/useGalleryShareFile", () => ({ useGalleryShareFile: shareFile }));
vi.mock("@/components/Gallery/gallery-share", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/Gallery/gallery-share")>()),
  downloadGalleryShareFile: downloadFile,
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
  shareFile.mockReturnValue({ data: new File(["image"], "Night.jpg", { type: "image/jpeg" }), isLoading: false, isError: false });
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  Object.defineProperty(navigator, "canShare", { configurable: true, value: undefined });
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
    fireEvent.click(screen.getByRole("button", { name: "gallery.copy-link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/gallery/photos/photo2?share_token=token`));
    expect(screen.queryByRole("button", { name: "memo.share.create-link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "memo.share.revoke" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByText("memo.share.active-links")).not.toBeInTheDocument();
    expect(screen.queryByText("gallery.share-scope")).not.toBeInTheDocument();
    expect(createShare).not.toHaveBeenCalled();
    expect(deleteShare).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "gallery.copy-link" })).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Instagram" })).toBeEnabled();
  });

  it("preserves the standard memo sharing dialog and its memo-scoped links", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<MemoSharePanel open memoName={memo.name} onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "memo.share.title" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "memo.share.copy" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/memos/shares/token`));
    fireEvent.click(screen.getByRole("button", { name: "memo.share.create-link" }));
    await waitFor(() => expect(createShare).toHaveBeenCalledWith({ memoName: memo.name, expireTime: undefined }));
    fireEvent.click(screen.getByRole("button", { name: "memo.share.revoke" }));
    await waitFor(() => expect(deleteShare).toHaveBeenCalledWith({ name: share.name, memoName: memo.name }));
  });

  it("shares the selected private photo with X and Telegram using an authorized token", () => {
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    const x = new URL(screen.getByRole("link", { name: "X" }).getAttribute("href")!);
    const telegram = new URL(screen.getByRole("link", { name: "Telegram" }).getAttribute("href")!);
    expect(x.hostname).toBe("x.com");
    expect(x.searchParams.get("url")).toBe(`${window.location.origin}/gallery/photos/photo2?share_token=token`);
    expect(x.searchParams.get("text")).toBe("Night");
    expect(telegram.hostname).toBe("t.me");
    expect(telegram.searchParams.get("url")).toBe(x.searchParams.get("url"));
    expect(createShare).not.toHaveBeenCalled();
  });

  it("keeps private file sharing available without exposing expired links or link-management controls", () => {
    listShares.mockReturnValue({ data: [{ ...share, expireTime: timestampFromDate(new Date(0)) }], isLoading: false });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Instagram" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "gallery.share-download" })).toBeEnabled();
    expect(shareFile).toHaveBeenCalledWith(attachment);
    expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "gallery.copy-link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "memo.share.create-link" })).not.toBeInTheDocument();
    expect(screen.queryByText("memo.share.no-links")).not.toBeInTheDocument();
    expect(createShare).not.toHaveBeenCalled();
  });

  it("downloads the image and copies its authorized link for Instagram when file sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(downloadFile).toHaveBeenCalledWith(expect.objectContaining({ name: "Night.jpg" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/gallery/photos/photo2?share_token=token`));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("gallery.share-instagram-download"));
    expect(screen.queryByText("gallery.share-instagram-download")).not.toBeInTheDocument();
  });

  it("opens native image sharing directly on the Instagram click and treats cancellation quietly", async () => {
    const nativeShare = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    Object.defineProperty(navigator, "share", { configurable: true, value: nativeShare });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(nativeShare).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "Night.jpg" })] });
    await waitFor(() => expect(screen.getByRole("button", { name: "Instagram" })).toBeEnabled());
    expect(downloadFile).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("reports clipboard failures instead of leaking an unhandled rejection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) },
    });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "gallery.copy-link" }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("gallery.copy-error"));
  });

  it("shares only the private image through the system when no share link exists", async () => {
    listShares.mockReturnValue({ data: [], isLoading: false });
    const nativeShare = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: nativeShare });
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "gallery.share-system" }));
    expect(nativeShare).toHaveBeenCalledWith({ title: "Night", files: [expect.objectContaining({ name: "Night.jpg" })] });
    await waitFor(() => expect(screen.getByRole("button", { name: "gallery.share-system" })).toBeEnabled());
    expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument();
    expect(createShare).not.toHaveBeenCalled();
  });

  it("downloads for Instagram without copying an inaccessible private URL", async () => {
    listShares.mockReturnValue({ data: [], isLoading: false });
    const writeText = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<GallerySharePanel photo={{ attachment, memo }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(downloadFile).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("gallery.share-instagram-download");
    expect(createShare).not.toHaveBeenCalled();
  });
});
