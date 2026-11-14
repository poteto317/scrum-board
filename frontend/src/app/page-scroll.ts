const AUTO_SCROLL_EDGE_PX = 48;
const AUTO_SCROLL_STEP_PX = 16;

type PageScrollDoc = Pick<Document, 'scrollingElement' | 'documentElement'>;

/** Document element that owns vertical page scrolling. */
export function pageScrollElement(doc: PageScrollDoc = document): Element | null {
  return doc.scrollingElement ?? doc.documentElement;
}

/** Scroll the page when the pointer sits at the viewport's top or bottom edge. */
export function autoScrollPageVertically(
  page: { scrollTop: number } | null | undefined,
  pointerY: number,
  viewportHeight: number,
): void {
  if (!page || viewportHeight <= 0) return;
  let delta = 0;
  if (pointerY < AUTO_SCROLL_EDGE_PX) delta = -AUTO_SCROLL_STEP_PX;
  else if (pointerY > viewportHeight - AUTO_SCROLL_EDGE_PX) delta = AUTO_SCROLL_STEP_PX;
  if (delta !== 0) page.scrollTop += delta;
}
