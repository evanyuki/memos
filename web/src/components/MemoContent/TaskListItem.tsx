import { useRef } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { useUpdateMemo } from "@/hooks/useMemoQueries";
import { setTaskChecked } from "@/utils/markdown-task-actions";
import { useMemoViewContext, useMemoViewDerived } from "../MemoView/MemoViewContext";
import type { ReactMarkdownProps } from "./markdown/types";

interface TaskListItemProps extends React.InputHTMLAttributes<HTMLInputElement>, ReactMarkdownProps {
  checked?: boolean;
}

export const TaskListItem: React.FC<TaskListItemProps> = ({ checked, node: _node, ...props }) => {
  const { memo } = useMemoViewContext();
  const { readonly } = useMemoViewDerived();
  const checkboxRef = useRef<HTMLButtonElement>(null);
  const { mutate: updateMemo } = useUpdateMemo();

  const handleChange = (newChecked: boolean) => {
    if (readonly || !memo) return;
    const start = checkboxRef.current?.closest("li")?.dataset.taskStart;
    if (start === undefined) return;
    const newContent = setTaskChecked(memo.content, Number(start), newChecked);
    if (newContent === memo.content) return;
    updateMemo({
      update: {
        name: memo.name,
        content: newContent,
      },
      updateMask: ["content", "update_time"],
    });
  };

  // Override the disabled prop from remark-gfm (which defaults to true).
  // `checked` is undefined for unchecked tasks; Base UI locks controlled/uncontrolled
  // mode at mount, so coerce to boolean to keep the checkbox always controlled.
  return (
    <Checkbox ref={checkboxRef} checked={Boolean(checked)} disabled={readonly} onCheckedChange={handleChange} className={props.className} />
  );
};
