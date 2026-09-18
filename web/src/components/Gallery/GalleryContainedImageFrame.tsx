import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface GalleryContainedImageFrameProps {
  width?: number;
  height?: number;
  className?: string;
  children: ReactNode;
}

export default function GalleryContainedImageFrame({ width, height, className, children }: GalleryContainedImageFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<{ width: number; height: number }>();

  const updateFrame = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || !width || !height || !stage.clientWidth || !stage.clientHeight) {
      setFrame(undefined);
      return;
    }

    const imageRatio = width / height;
    const stageRatio = stage.clientWidth / stage.clientHeight;
    const next =
      stageRatio > imageRatio
        ? { width: stage.clientHeight * imageRatio, height: stage.clientHeight }
        : { width: stage.clientWidth, height: stage.clientWidth / imageRatio };

    setFrame((current) =>
      current && Math.abs(current.width - next.width) < 0.5 && Math.abs(current.height - next.height) < 0.5 ? current : next,
    );
  }, [height, width]);

  useEffect(() => {
    updateFrame();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateFrame);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [updateFrame]);

  return (
    <div ref={stageRef} className={cn("relative flex size-full items-center justify-center overflow-visible", className)}>
      <div
        className="relative size-full shrink-0 overflow-visible"
        style={frame ? { width: frame.width, height: frame.height } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
