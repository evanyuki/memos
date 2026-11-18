/**
 * Slugify a string into a URL-friendly anchor ID. Keeps Unicode letters, digits and combining
 * marks, so non-Latin headings stay readable and scripts that write vowels as combining marks
 * (Devanagari, Thai, Arabic) are not reduced to their bare consonants.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * How headings were slugified before anchors kept Unicode: every non-ASCII character was dropped,
 * so "## Café" was `#caf`. Those anchors are in the wild — the outline writes the fragment into the
 * address bar, so they have been shared and bookmarked since v0.27.0.
 */
function legacySlugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Resolve an in-page fragment to its element, retrying against the pre-Unicode slug scheme so
 * anchors minted by older versions still land.
 */
export function findAnchorTarget(root: ParentNode, fragment: string): Element | null {
  if (!fragment) return null;

  const direct = root.querySelector(`#${CSS.escape(fragment)}`);
  if (direct) return direct;

  const slugCounts = new Map<string, number>();
  for (const heading of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const baseSlug = legacySlugify(heading.textContent ?? "");
    if (!baseSlug) continue;

    const count = slugCounts.get(baseSlug) ?? 0;
    slugCounts.set(baseSlug, count + 1);
    const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
    if (slug === fragment) return heading;
  }
  return null;
}

/** Find the rendered content container for a specific memo resource. */
export function findMemoContentRoot(root: ParentNode, memoName: string): Element | null {
  for (const memoContent of root.querySelectorAll("[data-memo-content]")) {
    if (memoContent.getAttribute("data-memo-name") === memoName) return memoContent;
  }
  return null;
}

/** Resolve a fragment inside one memo before falling back to page-level targets such as comments. */
export function findMemoAnchorTarget(root: ParentNode, memoName: string, fragment: string): Element | null {
  const memoContent = findMemoContentRoot(root, memoName);
  return (memoContent && findAnchorTarget(memoContent, fragment)) ?? findAnchorTarget(root, fragment);
}

/** Create a document-scoped generator that prevents generated suffixes from colliding with reserved or literal slugs. */
export function createUniqueSlugGenerator(reservedSlugs: Iterable<string> = []): (baseSlug: string) => string {
  const usedSlugs = new Set(reservedSlugs);

  return (baseSlug: string) => {
    let slug = baseSlug;
    let suffix = 0;
    while (usedSlugs.has(slug)) {
      suffix += 1;
      slug = `${baseSlug}-${suffix}`;
    }
    usedSlugs.add(slug);
    return slug;
  };
}
