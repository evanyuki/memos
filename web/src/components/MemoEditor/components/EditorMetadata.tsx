import type { FC } from "react";
import { AttachmentListEditor, LocationDisplayEditor, RelationListEditor } from "@/components/MemoMetadata";
import { useEditorContext, useEditorSelector } from "../state";
import type { EditorMetadataProps } from "../types";

export const EditorMetadata: FC<EditorMetadataProps> = ({ memoName, uploadingLocalFileURLs }) => {
  const { actions, dispatch } = useEditorContext();
  const attachments = useEditorSelector((s) => s.metadata.attachments);
  const localFiles = useEditorSelector((s) => s.localFiles);
  const relations = useEditorSelector((s) => s.metadata.relations);
  const location = useEditorSelector((s) => s.metadata.location);
  const placementActionsDisabled = useEditorSelector(
    (s) => s.ui.isLoading.saving || s.ui.isLoading.uploading || s.ui.pendingInlineImageInsertions > 0,
  );

  return (
    <div className="w-full flex flex-col gap-2">
      <AttachmentListEditor
        attachments={attachments}
        localFiles={localFiles}
        onAttachmentsChange={(next) => dispatch(actions.setMetadata({ attachments: next }))}
        onLocalFilesChange={(next) => dispatch(actions.setLocalFiles(next))}
        onRemoveLocalFile={(previewUrl) => dispatch(actions.removeLocalFile(previewUrl))}
        placementActionsDisabled={placementActionsDisabled}
        uploadingLocalFileURLs={uploadingLocalFileURLs}
        onRenamePendingChange={(pending) => dispatch(actions.setLoading("uploading", pending))}
      />

      <RelationListEditor
        relations={relations}
        onRelationsChange={(next) => dispatch(actions.setMetadata({ relations: next }))}
        memoName={memoName}
      />

      {location && <LocationDisplayEditor location={location} onRemove={() => dispatch(actions.setMetadata({ location: undefined }))} />}
    </div>
  );
};
