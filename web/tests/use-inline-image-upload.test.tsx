import { create } from "@bufbuild/protobuf";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PropsWithChildren, RefObject } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { UploadAnchorDescriptor } from "@/components/MemoEditor/Editor/uploadAnchors";
import { useInlineImageUpload } from "@/components/MemoEditor/hooks/useInlineImageUpload";
import { uploadService } from "@/components/MemoEditor/services";
import { EditorProvider, useEditorContext } from "@/components/MemoEditor/state";
import type { LocalFile } from "@/components/MemoEditor/types/attachment";
import type { EditorController } from "@/components/MemoEditor/types/editorController";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";

vi.mock("@/utils/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/i18n")>()),
  useTranslate: () => (key: string) => key,
}));
vi.mock("react-hot-toast", () => ({ toast: { error: vi.fn() } }));

const wrapper = ({ children }: PropsWithChildren) => <EditorProvider>{children}</EditorProvider>;

const localImage = (filename: string): LocalFile => ({
  file: new File([filename], filename, { type: "image/png" }),
  previewUrl: `blob:${filename}`,
  origin: "upload",
});

const remoteImage = (uid: string, filename: string) =>
  create(AttachmentSchema, {
    name: `attachments/${uid}`,
    filename,
    type: "image/png",
  });

const makeController = () => {
  const descriptors: UploadAnchorDescriptor[] = [];
  const controller = {
    createUploadAnchor: vi.fn((descriptor: UploadAnchorDescriptor) => descriptors.push(descriptor)),
    updateUploadAnchor: vi.fn((descriptor: UploadAnchorDescriptor) => descriptors.push(descriptor)),
    resolveUploadAnchor: vi.fn(),
    cancelUploadAnchor: vi.fn(),
    insertMarkdown: vi.fn(),
  } as unknown as EditorController;
  return { controller, descriptors };
};

describe("useInlineImageUpload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("adds visible attachments in selection order without inserting Markdown", async () => {
    const first = remoteImage("first", "first.png");
    const second = remoteImage("second", "second.png");
    vi.spyOn(uploadService, "uploadFile").mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { controller } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(() => ({ upload: useInlineImageUpload(editorRef), editor: useEditorContext() }), { wrapper });

    act(() => result.current.upload.insertLocalImages([localImage("first.png"), localImage("second.png")], 7));

    await waitFor(() => expect(controller.cancelUploadAnchor).toHaveBeenCalledTimes(1));
    expect(controller.createUploadAnchor).toHaveBeenCalledWith(expect.any(Object), 7);
    expect(controller.resolveUploadAnchor).not.toHaveBeenCalled();
    expect(result.current.editor.getState().metadata.attachments).toEqual([first, second]);
    expect(result.current.editor.getState().localFiles).toEqual([]);
    expect(result.current.editor.getState().content).toBe("");
  });

  test("passes the ingested local file, with its media metadata, straight to uploads", async () => {
    const upload = vi.spyOn(uploadService, "uploadFile").mockResolvedValue(remoteImage("first", "first.png"));
    const { controller } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(() => useInlineImageUpload(editorRef), { wrapper });
    const localFile: LocalFile = { ...localImage("first.png"), mediaMetadata: Promise.resolve(undefined) };

    act(() => result.current.insertLocalImages([localFile]));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload).toHaveBeenCalledWith(localFile);
  });

  test("preserves selection order when an earlier upload needs retrying", async () => {
    const first = remoteImage("first", "first.png");
    const second = remoteImage("second", "second.png");
    vi.spyOn(uploadService, "uploadFile")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(first);
    const { controller, descriptors } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(() => ({ upload: useInlineImageUpload(editorRef), editor: useEditorContext() }), { wrapper });
    act(() => result.current.upload.insertLocalImages([localImage("first.png"), localImage("second.png")]));
    await waitFor(() => expect(descriptors.at(-1)?.status).toBe("failed"));
    act(() => descriptors.at(-1)?.onRetry?.());
    await waitFor(() => expect(result.current.editor.getState().metadata.attachments).toEqual([first, second]));
    expect(controller.resolveUploadAnchor).not.toHaveBeenCalled();
  });

  test("serializes successive selections and exposes local thumbnails while uploading", async () => {
    const first = remoteImage("first", "first.png");
    const second = remoteImage("second", "second.png");
    let resolveFirst!: (attachment: typeof first) => void;
    const upload = vi
      .spyOn(uploadService, "uploadFile")
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(second);
    const { controller } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(() => ({ upload: useInlineImageUpload(editorRef), editor: useEditorContext() }), { wrapper });
    act(() => {
      result.current.upload.insertLocalImages([localImage("first.png")]);
      result.current.upload.insertLocalImages([localImage("second.png")]);
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(result.current.editor.getState().localFiles.map((file) => file.file.name)).toEqual(["first.png", "second.png"]);
    await act(async () => resolveFirst(first));
    await waitFor(() => expect(result.current.editor.getState().metadata.attachments).toEqual([first, second]));
    expect(result.current.editor.getState().localFiles).toEqual([]);
  });

  test("retries only failed files and preserves their original placement", async () => {
    const first = remoteImage("first", "first.png");
    const second = remoteImage("second", "second.png");
    const upload = vi
      .spyOn(uploadService, "uploadFile")
      .mockResolvedValueOnce(first)
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(second);
    const { controller, descriptors } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(() => ({ upload: useInlineImageUpload(editorRef), editor: useEditorContext() }), { wrapper });
    const files = [localImage("first.png"), localImage("second.png")];

    act(() => result.current.upload.insertLocalImages(files));
    await waitFor(() => expect(descriptors.at(-1)?.status).toBe("failed"));
    expect(controller.resolveUploadAnchor).not.toHaveBeenCalled();

    act(() => descriptors.at(-1)?.onRetry?.());
    await waitFor(() => expect(controller.cancelUploadAnchor).toHaveBeenCalledTimes(1));

    expect(upload).toHaveBeenCalledTimes(3);
    expect(upload.mock.calls.map(([file]) => file.file.name)).toEqual(["first.png", "second.png", "second.png"]);
    expect(result.current.editor.getState().metadata.attachments).toEqual([first, second]);
    expect(controller.resolveUploadAnchor).not.toHaveBeenCalled();
  });

  test("does not start local or remote insertion while a save is in progress", () => {
    const upload = vi.spyOn(uploadService, "uploadFile");
    const { controller } = makeController();
    const editorRef = { current: controller } as RefObject<EditorController>;
    const { result } = renderHook(
      () => {
        const inlineUpload = useInlineImageUpload(editorRef);
        const editor = useEditorContext();
        return { inlineUpload, editor };
      },
      { wrapper },
    );

    act(() => result.current.editor.dispatch(result.current.editor.actions.setLoading("saving", true)));
    act(() => {
      result.current.inlineUpload.insertLocalImages([localImage("late.png")]);
      result.current.inlineUpload.insertRemoteImages([remoteImage("late", "late.png")]);
    });

    expect(upload).not.toHaveBeenCalled();
    expect(controller.createUploadAnchor).not.toHaveBeenCalled();
    expect(controller.insertMarkdown).not.toHaveBeenCalled();
  });
});
