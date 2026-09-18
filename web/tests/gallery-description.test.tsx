import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MemoContent from "@/components/MemoContent";
import { MemoMarkdownRenderer } from "@/components/MemoContent/MemoMarkdownRenderer";

vi.mock("@/hooks/useUserQueries", () => ({
  useUsersByUsernames: () => ({ data: new Map() }),
}));

describe("gallery standalone memo description", () => {
  it("renders real tags and tasks without a MemoViewContext provider or editing actions", () => {
    const { container } = render(<MemoContent content={"Sunset #travel\n\n- [x] Edited\n- [ ] Print"} memoName="memos/photo" standalone />);
    expect(container.querySelector('[data-tag="travel"]')).toHaveTextContent("#travel");
    const tasks = screen.getAllByRole("checkbox");
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toBeChecked();
    expect(tasks[1]).not.toBeChecked();
    tasks.forEach((task) => expect(task).toBeDisabled());
  });
  it("preserves safe markdown and sanitizes executable HTML in standalone descriptions", () => {
    const { container } = render(
      <MemoMarkdownRenderer
        content={"**Story** #travel\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))"}
        resolvedMentionUsernames={new Set()}
        standalone
      />,
    );
    expect(container.querySelector("strong")).toHaveTextContent("Story");
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
