import type { ListItem } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";

// mdast points at the list marker, including for nested and quoted tasks.
function checkboxOffset(markdown: string, start: number): number | undefined {
  const marker = /(?:[-*+]|\d+[.)])[ \t]+\[[ xX]\]/y;
  marker.lastIndex = start;
  return marker.test(markdown) ? marker.lastIndex - 2 : undefined;
}

export function setTaskChecked(markdown: string, start: number, checked: boolean): string {
  const offset = checkboxOffset(markdown, start);
  if (offset === undefined || (markdown[offset] !== " ") === checked) return markdown;
  return markdown.slice(0, offset) + (checked ? "x" : " ") + markdown.slice(offset + 1);
}

function setAllTaskMarkers(markdown: string, checked: boolean): string {
  let tree: ReturnType<typeof fromMarkdown>;
  try {
    tree = fromMarkdown(markdown, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  } catch {
    return markdown;
  }

  const parts: string[] = [];
  let from = 0;
  visit(tree, "listItem", (node: ListItem) => {
    const start = node.position?.start.offset;
    if (typeof node.checked !== "boolean" || node.checked === checked || start === undefined) return;
    const offset = checkboxOffset(markdown, start);
    if (offset === undefined) return;
    parts.push(markdown.slice(from, offset), checked ? "x" : " ");
    from = offset + 1;
  });
  return parts.length ? parts.join("") + markdown.slice(from) : markdown;
}

export function uncheckAllTasks(markdown: string): string {
  return setAllTaskMarkers(markdown, false);
}

export function checkAllTasks(markdown: string): string {
  return setAllTaskMarkers(markdown, true);
}
