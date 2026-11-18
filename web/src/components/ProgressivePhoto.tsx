import { type ComponentProps, useEffect, useState } from "react";

// Keep the thumbnail visible until the selected display image is ready.
const ProgressivePhoto = ({ src, posterUrl, alt, ...props }: ComponentProps<"img"> & { src: string; posterUrl?: string }) => {
  const [loadedSource, setLoadedSource] = useState<string>();

  useEffect(() => {
    if (!posterUrl || posterUrl === src) return;

    let cancelled = false;
    const image = new window.Image();
    image.decoding = "async";
    image.onload = async () => {
      await image.decode?.().catch(() => {});
      if (!cancelled) setLoadedSource(src);
    };
    image.src = src;

    return () => {
      cancelled = true;
      image.onload = null;
      image.removeAttribute("src");
    };
  }, [src, posterUrl]);

  return <img {...props} src={loadedSource === src ? src : posterUrl || src} alt={alt} onError={() => setLoadedSource(src)} />;
};

export default ProgressivePhoto;
