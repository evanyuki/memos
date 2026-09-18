import type { Element, ElementContent, Root, RootContent } from "hast";

const isSpacing = (node: RootContent): boolean =>
  (node.type === "text" && node.value.trim() === "") || (node.type === "element" && node.tagName === "br");

const paragraphImages = (node: RootContent): Element[] | undefined => {
  if (node.type !== "element" || node.tagName !== "p") return undefined;
  const images = node.children.filter((child) => !isSpacing(child));
  return images.length > 0 && images.every((child) => child.type === "element" && child.tagName === "img")
    ? (images as Element[])
    : undefined;
};

/** Group consecutive image paragraphs without moving photos past their captions or other text. */
export const rehypeMemoImages = ({ hideImages = false }: { hideImages?: boolean } = {}) => {
  return (tree: Root) => {
    const transform = (parent: Root | Element, insideLink = false) => {
      for (const child of parent.children) {
        if (child.type !== "element") continue;
        if (child.tagName === "img" && insideLink) child.properties["data-memo-linked-image"] = true;
        transform(child, insideLink || child.tagName === "a");
      }
      if (hideImages) {
        parent.children = parent.children.filter(
          (child) => child.type !== "element" || (child.tagName !== "img" && !(child.tagName === "p" && child.children.every(isSpacing))),
        ) as ElementContent[];
        return;
      }
      for (let index = 0; index < parent.children.length; index++) {
        const firstImages = paragraphImages(parent.children[index]);
        if (!firstImages) continue;
        const images = [...firstImages];
        let end = index + 1;
        while (end < parent.children.length) {
          let next = end;
          while (next < parent.children.length && isSpacing(parent.children[next])) next++;
          const nextImages = parent.children[next] && paragraphImages(parent.children[next]);
          if (!nextImages) break;
          images.push(...nextImages);
          end = next + 1;
        }
        if (images.length < 2) continue;
        parent.children.splice(index, end - index, {
          type: "element",
          tagName: "div",
          properties: { "data-memo-image-gallery": true },
          children: images,
        });
      }
    };
    transform(tree);
  };
};
