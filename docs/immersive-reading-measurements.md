# Immersive reading: what competed with the page, and the contract that replaced it

Design record from 2026-08-19, kept for the reasoning. The shortfall measured below was the
reason for the immersive layout; it has since been closed. `test/immersive-layout.pw.mjs`
measures `#reader` in the shipped panel and requires at least 90% of both dimensions, so the
figures in the first table describe the layout that was replaced, not the one that ships.

## The inventory that was measured, at the default 640x900 panel

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

**In that layout the page got about 78.8% of the usable vertical and about 95.6% of the usable
horizontal.** The immersive target is at least 90% of both, so that layout fell short on the
vertical axis by about 11 points. The vertical chrome that had to move was the header and rungs,
the title block, the progress bar, the visible pager buttons, and the footer.

## The target layout contract, which the shipped panel now meets

- While `#view-reading` is active, `#reader` occupies **>= 90% of both usable panel dimensions**.
- Everything displaced is reachable behind **exactly one menu affordance** (a single button, e.g.
  a top-corner "..." that opens one overlay). No second menu is ever introduced; the star calendar
  lives behind this same menu.
- **Page-turn stays reachable without opening the menu.** Arrow keys already bind (Left/Right ->
  prev/next); the visible pager buttons may move into an auto-hiding overlay that appears on hover
  or key focus, so the page can still be turned by mouse without the menu.
- Moved behind the menu: the `.rungs` nav, the brand, the title block (`#book-title` + `#book-why`),
  the progress bar, the footer status/advance, and the star calendar. Kept: `#reader` (the page) and
  a minimal auto-hiding pager overlay.
- This does not contradict the "one window, no second window" decision in `docs/GOAL_LOOP.md`: the
  menu is an in-panel overlay within the single companion window, not a second OS window.
