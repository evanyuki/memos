export default function GalleryLinearBlur() {
  const step = 100 / 8;
  const base = (128 / 0.5) ** (1 / 7);
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 h-16" aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => {
        const blur = `blur(${0.5 * base ** (6 - index)}px)`;
        const mask =
          index === 0
            ? `linear-gradient(to bottom, black 0%, black ${step}%, transparent ${step * 2}%)`
            : `linear-gradient(to bottom, transparent ${(index - 1) * step}%, black ${index * step}%, black ${(index + 1) * step}%, transparent ${(index + 2) * step}%)`;
        return (
          <div key={blur} className="absolute inset-0" style={{ maskImage: mask, backdropFilter: blur, WebkitBackdropFilter: blur }} />
        );
      })}
      <div className="absolute inset-0 bg-linear-to-b from-[var(--gallery-background)] to-transparent opacity-80" />
    </div>
  );
}
