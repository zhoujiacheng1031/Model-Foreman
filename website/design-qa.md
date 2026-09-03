# Design QA

## Comparison target

- Source visual truth: selected Guided Product Tour design reference from the product-design exploration.
- Browser-rendered implementation capture: local desktop viewport QA capture.
- Final comparison evidence: side-by-side design and browser review completed before release.
- Reference pixels: 1487 × 1058.
- Implementation browser viewport: 1140 × 1100 CSS px at device scale 1.
- Final comparison board: 1693 × 929 px; both captures normalized to equal displayed width without cropping.
- State: desktop, light theme, homepage, workbench product view selected.

The reference and implementation have different source viewport widths. The comparison therefore evaluates responsive composition, hierarchy, and proportional rhythm rather than pixel-level coordinates.

## Full-view comparison evidence

The final browser capture preserves the selected direction's centered hero, compact glass navigation, two-line value proposition, paired calls to action, large authentic application window, pale blue-white material system, and product-flow rail. The real application screenshot is the dominant visual and all potentially identifying paths are replaced with public demo values.

## Focused region evidence

- Hero and product stage: inspected in the final combined comparison board above.
- Workflow and real-product section: inspected in the browser at `http://localhost:3000/#workflow`; the heading, four equal cards, real task-input screenshot, spacing, and section transition rendered without clipping or overlap.
- Product interaction: selected both “任务输入” and “模型设置”; the selected tab state and screenshot transition updated correctly.
- Additional focused crops were not required because typography, navigation, buttons, and primary screenshot labels are legible in the full comparison and the dense app UI is itself a supplied raster asset.

## Required fidelity surfaces

- Fonts and typography: Geist with PingFang SC/system fallback produces the intended developer-tool tone. Display weight, two-line wrap, body hierarchy, and compact mono labels align with the reference.
- Spacing and layout rhythm: navigation, hero, CTA group, product window, and switcher share a consistent centered track. Card radii and section spacing use a single scale.
- Colors and visual tokens: the implementation follows the reference's white, cool gray, pale blue, and violet system with sufficient text contrast and restrained semantic color.
- Image quality and asset fidelity: the hero and supporting sections use actual Model Foreman interface captures. Workbench and settings captures were privacy-scrubbed without adding product claims; screenshots are not reconstructed with HTML or CSS art.
- Copy and content: messaging is standardized around “规划—隔离执行—本地验证—人工批准” and “从目标到交付，每一步都有证据。” Terminology is consistent across hero, workflow, capabilities, and download sections.

## Comparison history

### Iteration 1

- [P2] The product window started too low and the view switcher consumed above-the-fold space, so the main screenshot did not reach the same visible depth as the reference.
- Fix: removed the extra hero metadata row, moved the product switcher below the window, reduced the hero-to-window gap, and tightened the screenshot viewport from a 48vw/600px maximum to 40vw/500px.
- Post-fix evidence: the final comparison board shows the real product window beginning immediately after the CTA group, with the switcher visible at the bottom of the viewport.

- [P2] The workflow heading wrapped into four narrow lines at the verification viewport.
- Fix: rebalanced the workflow grid to 0.9/1.1, reduced the gap, and capped the workflow heading at 50px.
- Post-fix evidence: the browser-rendered `#workflow` view preserves the authored two-line heading and balanced card grid.

### Iteration 2

No actionable P0, P1, or P2 differences remain.

## Findings

No blocking findings.

## Follow-up polish

- [P3] The reference includes a decorative thread path. It is intentionally omitted because no source asset exists and approximating it with CSS or a handcrafted vector would reduce asset fidelity.
- [P3] The primary CTA says “下载桌面版” instead of the concept's “开始使用” so the action matches the real GitHub Release destination.

## Verification

- Primary interactions tested: product view tabs, anchor navigation to the workflow section, guide/release link targets present in the accessibility tree.
- Browser-visible runtime errors: none observed; the local dev server reported successful 200 renders and no client errors during interaction.
- Automated checks: `npm run lint` passed; `npm run test` passed with 5/5 tests; production build completed.

## Implementation checklist

- [x] Selected visual direction implemented.
- [x] Real, privacy-safe product screenshots placed.
- [x] Product tour tabs made keyboard- and pointer-interactive.
- [x] Responsive layout and reduced-motion treatment included.
- [x] Metadata and page copy unified.
- [x] Lint, build, tests, and browser design QA passed.

final result: passed
