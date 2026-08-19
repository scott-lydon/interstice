# Immersive reading: what competes with the page (2A.1), and the target contract (2A.2)

## 2A.1 — measured inventory at the default 640x900 panel

Panel usable area = 640 x 900 (body is full-bleed, `overflow:hidden`). Figures are computed from the
CSS in `web/panel.html`: box heights are padding + content + border for the fixed-height chrome.

| Element | Role | Vertical px | Horizontal px |
|---|---|---|---|
| `<header>` (brand + `.rungs` nav) | app chrome, sticky | ~33 (10+10 pad + ~12 line + 1 border) | 640 full width |
| `main` padding | frame around the view | 28 (14 top + 14 bottom) | 28 (14 + 14) |
| `.view header` (`#book-title` h2 + `#book-why`) | title block | ~40 + 12 gap | within main |
| `.bar` (`#book-bar`) | progress bar | 3 + 12 gap | within main |
| page controls row (`#page-prev`, `#reader-page`, `#reader-mode`, `#page-next`) | pager | ~24 + 12 gap | within main |
| `#book-actions`, `#reader-note` | retry / note (note hidden by default) | ~0 when idle | within main |
| `<footer>` (`#status`, `#advance`) | status + advance | ~27 (8+8 pad + ~10 line + 1 border) | 640 full width |
| `#reader` (the page, `flex:1 1 auto`) | **the page itself** | remainder | 640 - 28 = 612 |

Vertical chrome total ≈ 33 + 28 + 40 + 12 + 3 + 12 + 24 + 12 + 27 = **~191 px**.
Page vertical = 900 - 191 = **~709 px = 78.8% of 900**.
Page horizontal = 640 - 28 = **612 px = 95.6% of 640**.

**The page gets ~78.8% of the usable vertical and ~95.6% of the usable horizontal.** The immersive
target is >=90% of BOTH, so the current build fails on the vertical axis by ~11 points. The vertical
chrome that must move to reach >=90% is the header/rungs, the title block, the progress bar, the
visible pager buttons, and the footer.

## 2A.2 — target layout contract

- While `#view-reading` is active, `#reader` occupies **>= 90% of both usable panel dimensions**.
- Everything displaced is reachable behind **exactly one menu affordance** (a single button, e.g.
  a top-corner "..." that opens one overlay). No second menu is ever introduced; the Phase 3 star
  calendar lives behind this same menu (see 2A.4).
- **Page-turn stays reachable without opening the menu.** Arrow keys already bind (Left/Right ->
  prev/next); the visible pager buttons may move into an auto-hiding overlay that appears on hover
  or key focus, so the page can still be turned by mouse without the menu.
- Moved behind the menu: the `.rungs` nav, the brand, the title block (`#book-title` + `#book-why`),
  the progress bar, the footer status/advance, and the star calendar. Kept: `#reader` (the page) and
  a minimal auto-hiding pager overlay.
- This does not contradict the "one window, no second window" decision in `docs/GOAL_LOOP.md`: the
  menu is an in-panel overlay within the single companion window, not a second OS window.
