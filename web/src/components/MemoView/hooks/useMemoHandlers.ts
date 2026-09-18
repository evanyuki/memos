import { useCallback } from "react";
import { useInstance } from "@/contexts/InstanceContext";

interface UseMemoHandlersOptions {
  readonly: boolean;
  openEditor: () => void;
}

export const useMemoHandlers = (options: UseMemoHandlersOptions) => {
  const { readonly, openEditor } = options;
  const { memoRelatedSetting } = useInstance();

  const handleMemoContentDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (readonly) return;
      if (memoRelatedSetting.enableDoubleClickEdit) {
        e.preventDefault();
        openEditor();
      }
    },
    [readonly, openEditor, memoRelatedSetting.enableDoubleClickEdit],
  );

  return { handleMemoContentDoubleClick };
};
