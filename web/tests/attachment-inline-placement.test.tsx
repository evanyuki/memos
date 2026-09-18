import { create } from "@bufbuild/protobuf";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AttachmentListEditor from "@/components/MemoMetadata/Attachment/AttachmentListEditor";
import { AttachmentSchema, MotionMediaFamily, MotionMediaRole, MotionMediaSchema } from "@/types/proto/api/v1/attachment_service_pb";

const { rename } = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock("@/hooks/useAttachmentQueries", () => ({ useUpdateAttachment: () => ({ mutateAsync: rename }) }));
vi.mock("@/components/PreviewImageDialog", () => ({ default: () => null }));

const image = create(AttachmentSchema, { name: "attachments/photo", filename: "photo.png", type: "image/png", size: 128n });
const second = create(AttachmentSchema, { ...image, name: "attachments/second", filename: "second.png" });
const third = create(AttachmentSchema, { ...image, name: "attachments/third", filename: "third.png" });
beforeEach(() => {
  rename.mockReset();
});

describe("visual image attachment editor", () => {
  it("shows thumbnails and image controls without an inline-link action", () => {
    render(<AttachmentListEditor attachments={[image]} onAttachmentsChange={vi.fn()} />);
    expect(screen.getByRole("img", { name: "photo.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rename image: photo.png" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Insert image" })).not.toBeInTheDocument();
  });
  it("moves a dragged image to its dropped position", () => {
    const onAttachmentsChange = vi.fn();
    render(<AttachmentListEditor attachments={[image, second, third]} onAttachmentsChange={onAttachmentsChange} />);
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(screen.getByRole("button", { name: "Drag to reorder photo.png" }), { dataTransfer });
    fireEvent.dragOver(screen.getByRole("img", { name: "third.png" }), { dataTransfer });
    fireEvent.drop(screen.getByRole("img", { name: "third.png" }), { dataTransfer });
    expect(onAttachmentsChange).toHaveBeenCalledWith([second, third, image]);
  });
  it("keeps Live Photo members together when using keyboard reorder", () => {
    const still = create(AttachmentSchema, {
      ...image,
      motionMedia: create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.STILL, groupId: "live" }),
    });
    const video = create(AttachmentSchema, {
      name: "attachments/video",
      filename: "photo.mov",
      type: "video/quicktime",
      motionMedia: create(MotionMediaSchema, { family: MotionMediaFamily.APPLE_LIVE_PHOTO, role: MotionMediaRole.VIDEO, groupId: "live" }),
    });
    const onAttachmentsChange = vi.fn();
    render(<AttachmentListEditor attachments={[still, video, second]} onAttachmentsChange={onAttachmentsChange} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Drag to reorder photo.png" }), { key: "ArrowRight" });
    expect(onAttachmentsChange).toHaveBeenCalledWith([second, still, video]);
  });
  it("saves a filename through the API and retains the current order", async () => {
    const updated = create(AttachmentSchema, { ...image, filename: "Sunrise.png" });
    rename.mockResolvedValue(updated);
    const onAttachmentsChange = vi.fn();
    render(<AttachmentListEditor attachments={[second, image]} onAttachmentsChange={onAttachmentsChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename image: photo.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Image name" }), { target: { value: "Sunrise.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onAttachmentsChange).toHaveBeenCalledWith([second, updated]));
    expect(rename).toHaveBeenCalledWith({ name: image.name, filename: "Sunrise.png" });
  });
  it("keeps the editor open on rename failure without changing attachments", async () => {
    rename.mockRejectedValue(new Error("offline"));
    const onAttachmentsChange = vi.fn();
    render(<AttachmentListEditor attachments={[image]} onAttachmentsChange={onAttachmentsChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename image: photo.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Image name" }), { target: { value: "Sunrise.png" } });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Image name" }), { key: "Enter" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not rename image");
    expect(onAttachmentsChange).not.toHaveBeenCalled();
  });
  it("renames a local image while retaining its blob and metadata", async () => {
    const local = {
      file: new File(["image"], "local.png", { type: "image/png" }),
      previewUrl: "blob:local",
      mediaMetadata: Promise.resolve(undefined),
    };
    const onLocalFilesChange = vi.fn();
    render(<AttachmentListEditor attachments={[]} localFiles={[local]} onLocalFilesChange={onLocalFilesChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename image: local.png" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Image name" }), { target: { value: "renamed.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onLocalFilesChange).toHaveBeenCalled());
    const renamed = onLocalFilesChange.mock.calls[0][0][0];
    expect(renamed.file.name).toBe("renamed.png");
    expect(renamed.previewUrl).toBe(local.previewUrl);
    expect(renamed.mediaMetadata).toBe(local.mediaMetadata);
    expect(rename).not.toHaveBeenCalled();
  });
  it("shows upload state and locks image mutations while files are uploading", () => {
    const local = { file: new File(["image"], "local.png", { type: "image/png" }), previewUrl: "blob:local" };
    render(
      <AttachmentListEditor
        attachments={[]}
        localFiles={[local]}
        uploadingLocalFileURLs={new Set([local.previewUrl])}
        onLocalFilesChange={vi.fn()}
        placementActionsDisabled
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Uploading");
    expect(screen.getByRole("button", { name: "Remove image" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rename image: local.png" })).toBeDisabled();
  });
});
