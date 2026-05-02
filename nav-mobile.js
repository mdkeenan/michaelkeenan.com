(function () {
  const MEDIA_MOBILE_NAV = "(max-width: 860px)";
  /** Snap / “near end” tolerance for mapping scrollLeft ↔ page index (iOS rounds scroll positions aggressively). */
  const PAGE_SCROLL_SLACK_PX = 48;
  /** Persisted horizontal scroll position for the nav strip (mobile). */
  const STORAGE_KEY_NAV_SCROLL = "minimal-dark-site:nav-mobile-scroll-left";

  const mq = window.matchMedia(MEDIA_MOBILE_NAV);
  const wrap = document.querySelector(".sidebar__nav-wrap");
  const nav = document.querySelector("#site-nav");
  const btnPrev = document.querySelector("[data-nav-prev]");
  const btnNext = document.querySelector("[data-nav-next]");

  if (!wrap || !nav || !btnPrev || !btnNext) return;

  let pages = [];
  let navPageIndex = 0;
  /** Ignore ResizeObserver/sync scroll derivation during intentional pager moves. */
  let ignoreResizeSync = false;
  /** ScrollLeft read from sessionStorage on this page load; cleared after first successful apply. */
  let savedScrollLeftToApply = null;

  function readStoredScrollLeft() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY_NAV_SCROLL);
      if (raw == null) return null;
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) && n >= 0 ? n : null;
    } catch {
      return null;
    }
  }

  function persistNavScrollLeft() {
    if (!mq.matches) return;
    computePages();
    if (pages.length <= 1) {
      try {
        sessionStorage.removeItem(STORAGE_KEY_NAV_SCROLL);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY_NAV_SCROLL, String(Math.round(nav.scrollLeft)));
    } catch {
      /* ignore */
    }
  }

  /** Click target may be a Text node; closest() exists only on Element. */
  function clickedSidebarLink(event) {
    const t = event.target;
    const el = t && t.nodeType === Node.ELEMENT_NODE ? t : t.parentElement;
    const a = el && typeof el.closest === "function" ? el.closest("a.sidebar__link") : null;
    return a && nav.contains(a) ? a : null;
  }

  /**
   * Horizontal span of nav links [start, endExclusive) using layout geometry (not sum of widths).
   * Avoids border/overlap mistakes that let a page “fit” in JS while the strip still clips on screen.
   */
  function segmentSpanPx(links, start, endExclusive) {
    if (start >= endExclusive || start >= links.length) return 0;
    const lastIdx = Math.min(endExclusive - 1, links.length - 1);
    const left = links[start].offsetLeft;
    const right = links[lastIdx].offsetLeft + links[lastIdx].offsetWidth;
    return right - left;
  }

  function computePages() {
    const links = [...nav.querySelectorAll(".sidebar__link")];
    pages = [];
    if (!mq.matches || links.length === 0) return;

    const vw = nav.clientWidth;
    /** Tiny slack for subpixel rounding (segment geometry is otherwise exact). */
    const FIT_EPS_PX = 1;
    let start = 0;

    while (start < links.length) {
      pages.push(links[start].offsetLeft);

      let endExclusive = start + 1;
      while (
        endExclusive <= links.length &&
        segmentSpanPx(links, start, endExclusive) <= vw + FIT_EPS_PX
      ) {
        endExclusive += 1;
      }
      endExclusive -= 1;

      if (endExclusive <= start) {
        endExclusive = start + 1;
      }

      start = endExclusive;
    }
  }

  function pageIndexFromScroll() {
    if (pages.length === 0) return 0;
    if (pages.length === 1) return 0;

    const sl = nav.scrollLeft;
    const maxScroll = Math.max(0, nav.scrollWidth - nav.clientWidth);

    if (maxScroll > 0 && maxScroll - sl <= PAGE_SCROLL_SLACK_PX) {
      return pages.length - 1;
    }

    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < pages.length; i += 1) {
      const snap = Math.round(pages[i]);
      const dist = Math.abs(sl - snap);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return best;
  }

  function applyPagerDisabled() {
    if (pages.length <= 1) return;
    btnPrev.disabled = navPageIndex <= 0;
    btnNext.disabled = navPageIndex >= pages.length - 1;
  }

  function scrollLeftForPage(index) {
    if (index <= 0) return 0;
    const maxScroll = Math.max(0, nav.scrollWidth - nav.clientWidth);
    if (index >= pages.length) return maxScroll;
    /* Left-align each segment; clamp for safety. Last segment uses its start, not maxScroll (avoids wrong tail snap). */
    return Math.min(maxScroll, Math.round(pages[index]));
  }

  function updatePagerUi() {
    if (!mq.matches) {
      btnPrev.hidden = true;
      btnNext.hidden = true;
      btnPrev.disabled = false;
      btnNext.disabled = false;
      nav.scrollLeft = 0;
      navPageIndex = 0;
      return;
    }

    computePages();

    if (pages.length <= 1) {
      btnPrev.hidden = true;
      btnNext.hidden = true;
      btnPrev.disabled = false;
      btnNext.disabled = false;
      navPageIndex = 0;
      return;
    }

    navPageIndex = Math.min(Math.max(0, navPageIndex), pages.length - 1);

    btnPrev.hidden = false;
    btnNext.hidden = false;
    applyPagerDisabled();
  }

  /**
   * Apply scrollLeft from sessionStorage once nav has real dimensions.
   * Uses pixel scroll so restore matches what the user saw; survives layout timing.
   */
  function applySavedScrollOnce() {
    if (savedScrollLeftToApply == null || !mq.matches) return false;
    computePages();
    if (pages.length <= 1 || nav.clientWidth <= 0) return false;
    const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
    nav.scrollLeft = Math.min(savedScrollLeftToApply, max);
    savedScrollLeftToApply = null;
    navPageIndex = pageIndexFromScroll();
    applyPagerDisabled();
    return true;
  }

  function go(delta) {
    if (!mq.matches) return;
    computePages();
    if (pages.length <= 1) return;

    navPageIndex = Math.min(Math.max(0, navPageIndex + delta), pages.length - 1);
    ignoreResizeSync = true;
    /* Instant scroll avoids smooth-scroll races with ResizeObserver / scrollLeft reads. */
    nav.scrollLeft = scrollLeftForPage(navPageIndex);
    /* Don’t trust scrollLeft readback here — Mobile Safari can report a low value for one frame / subpixels and force index 0, which keeps ‹ disabled. */
    applyPagerDisabled();
    persistNavScrollLeft();
    window.requestAnimationFrame(() => {
      ignoreResizeSync = false;
      updatePagerUi();
    });
  }

  function syncAfterLayoutChange() {
    if (ignoreResizeSync) return;
    applySavedScrollOnce();
    computePages();
    if (mq.matches && pages.length > 1) {
      navPageIndex = Math.min(Math.max(0, pageIndexFromScroll()), pages.length - 1);
    }
    updatePagerUi();
  }

  btnPrev.addEventListener("click", () => go(-1));
  btnNext.addEventListener("click", () => go(1));

  nav.addEventListener(
    "click",
    (e) => {
      if (!clickedSidebarLink(e)) return;
      if (!mq.matches) return;
      computePages();
      if (pages.length <= 1) return;
      persistNavScrollLeft();
    },
    true
  );

  window.addEventListener("resize", syncAfterLayoutChange);

  mq.addEventListener("change", () => {
    navPageIndex = 0;
    nav.scrollLeft = 0;
    savedScrollLeftToApply = null;
    if (!mq.matches) {
      try {
        sessionStorage.removeItem(STORAGE_KEY_NAV_SCROLL);
      } catch {
        /* ignore */
      }
    }
    updatePagerUi();
  });

  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(syncAfterLayoutChange);
    ro.observe(nav);
  }

  function boot() {
    savedScrollLeftToApply = mq.matches ? readStoredScrollLeft() : null;
    navPageIndex = 0;

    function afterLayout() {
      updatePagerUi();
      applySavedScrollOnce();
      /* If width was still 0, ResizeObserver will retry applySavedScrollOnce. */
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(afterLayout);
    });
  }

  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      savedScrollLeftToApply = mq.matches ? readStoredScrollLeft() : null;
      syncAfterLayoutChange();
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
