import { cn } from "@/lib/utils";
import type { ReactMarkdownProps } from "./types";

interface ImageProps extends React.ImgHTMLAttributes<HTMLImageElement>, ReactMarkdownProps {
  onPreview?: () => void;
}

/**
 * Image component for markdown images
 * Responsive with rounded corners
 */
export const Image = ({ className, alt, node: _node, height, width, style, onPreview, ...props }: ImageProps) => {
  const image = (
    <img
      className={cn("max-w-full my-2", !height && "h-auto", className)}
      alt={alt}
      style={{ height: height ? `${height}px` : undefined, width: width ? `${width}px` : undefined, ...style }}
      {...props}
      loading="lazy"
      decoding="async"
    />
  );
  return onPreview ? (
    <button
      type="button"
      className="max-w-full cursor-zoom-in rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onPreview}
      onDoubleClick={(event) => event.stopPropagation()}
      aria-label={alt || "Image"}
    >
      {image}
    </button>
  ) : (
    image
  );
};
