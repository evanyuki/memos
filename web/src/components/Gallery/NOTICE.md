# Afilmory reuse notice

The gallery Inspector layout, histogram presentation, contained-image frame, progressive header blur, accent contrast calculation, share preview and photo-first material styling in this directory are adapted from Afilmory/Lifemory at commit `16bf27b97c1fed9febbdb5959b115a0b0cef5bef`.

Source: https://github.com/Afilmory/Afilmory/tree/16bf27b97c1fed9febbdb5959b115a0b0cef5bef  
License: AGPL-3.0-or-later with the Attribution Network License UI notice requirements.

Memos adaptation date: 2026-09-18. The API, permission checks, attachment URLs, sharing and the Memos theme remain Memos code. The preview-analysis formulas are adapted from Afilmory's MIT-licensed builder histogram module and are marked in `preview-colors.ts`.

Upstream sources:

- `apps/web/src/modules/gallery/MasonryView.tsx`: layout dimensions; Memos uses the same `masonic` library directly with document scrolling.
- `packages/ui/src/progressive-blur/index.tsx`: `GalleryLinearBlur`, narrowed to the top-header recipe.
- `apps/web/src/modules/viewer/ContainedImageFrame.tsx`: `GalleryContainedImageFrame`.
- `apps/web/src/modules/viewer/` and `apps/web/src/modules/inspector/`: viewer and Inspector presentation, adapted to Memos media items and existing UI primitives.
- `apps/web/src/lib/color.ts`: `gallery-accent.ts`, without the Thumbhash loading dependencies.
- `apps/web/src/modules/social/ShareModal.tsx` and `SharePreview.tsx`: photo sharing layout and preview loading/retry; Memos retains its existing memo-scoped share links.
- `packages/builder/src/image/histogram.ts`: preview tone analysis formulas.

This adaptation unifies the photo route into one viewer, removes raw metadata debugging UI and duplicate filter/navigation variants, and mounts Memos descriptions inside the Inspector. Gallery comments and the attribution footer were removed at the user's request. Source attribution is retained in this notice and the complete upstream license is included in `LICENSE`. No Lifemory backend, Builder runtime, private storage configuration or external sync service is required.
