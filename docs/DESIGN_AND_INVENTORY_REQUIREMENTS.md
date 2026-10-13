# NOUVO POS Cash & Carry — Visual UX and Inventory Editing Requirements

**Status:** Approved product requirement addendum

## 1. Visual direction

Create a premium, polished, modern retail POS that feels fluid and responsive rather than like a generic admin dashboard. Use Pinterest references as inspiration for quality, composition, color harmony, and motion—not as assets to copy pixel-for-pixel. The supplied Pinterest pin could not be fetched directly by the research browser, so its exact visuals have not yet been verified. If a screenshot is supplied later, refine this direction against it.

### Visual quality

- Use a cohesive color system: carefully blended complementary colors, restrained gradients, clear contrast, semantic colors for success/warning/error, and accessible text contrast. Avoid random rainbow gradients or low-contrast text.
- Use consistent spacing, typography, icon weights, radii, shadows, borders, and component states across every screen.
- Build polished reusable components for buttons, fields, tabs, dialogs, tables, cards, dropdowns, toasts, loading states, and empty/error states.
- Use smooth micro-interactions for hover, press, focus, opening/closing, saving, navigation, and cart changes. Motion should feel immediate and continuous, with no unnecessary delays, jank, or exaggerated animations.
- Respect reduced-motion preferences and keep animations subtle enough not to slow down checkout.
- Keep cashier workflows optimized for keyboard, barcode scanner, and mouse. Animations must never block scanning, payment, or other critical input.
- Use high-resolution vector icons and scalable assets; use 4K-quality source assets where useful, but do not upscale low-quality images and do not render the entire application at 4K unnecessarily.
- Include light/dark theme only if both can be implemented consistently and tested; do not let theme options compromise checkout clarity.

## 2. Performance and the 200 FPS target

The product should feel exceptionally fluid. A requested 200+ FPS is a design aspiration, not a guarantee across all computers, displays, Electron compositors, and operating systems. A 60 Hz display cannot show 200 distinct frames per second; high-refresh monitors may benefit from higher frame rates. Therefore:

- Keep main-thread work short; avoid expensive synchronous work during interactions and checkout.
- Virtualize large product/inventory lists and use efficient search/filtering.
- Debounce only non-critical search/filter requests; never delay barcode scans or payment confirmation.
- Avoid unnecessary component re-renders, large synchronous IPC payloads, and blocking database work on the UI thread.
- Use transform/opacity animations where appropriate, measure actual performance, and profile on supported hardware.
- Target smooth 60 FPS on the agreed baseline hardware, and aim to take advantage of 120/144/165/200+ Hz displays where the environment supports it. Set measurable budgets for startup, barcode-to-cart response, search response, save feedback, and checkout completion after baseline hardware is selected.
- All actions must provide immediate feedback, prevent accidental duplicate submissions, and recover cleanly from errors. Never display a fake success state before persistence is confirmed.

## 3. Inventory must be editable after creation

Adding a product is not a one-time action. Authorized users must be able to open an existing item and edit its details later.

### Editable product fields

- Product name, short/long description, category, brand, supplier association
- SKU, one or more barcodes, internal reference code
- Purchase cost, selling price, wholesale price, and other configured price levels
- Tax category/rate and tax-included/excluded behavior where applicable
- Base unit and packaging/unit conversions
- Minimum stock/reorder threshold and other non-financial stock settings
- Product image, active/inactive status, and permitted metadata
- Batch/expiry settings where enabled and appropriate

### Pricing and inventory history safeguards

- Price changes must be saved as new effective values with an audit trail containing old value, new value, user, timestamp, and optional reason.
- Changing the current selling price affects new sales only. It must not rewrite prices on completed historical sale lines, receipts, refunds, or accounting journals.
- Purchase cost changes must not rewrite historic purchase receipts or posted journal entries. Inventory valuation follows the approved costing method and stock movement ledger.
- If a product already has stock movements or completed sales, edits to its identity, base unit, or tracking method must be validated. Block unsafe changes and direct the user to a controlled conversion, adjustment, or replacement workflow.
- SKU/barcode uniqueness must be validated. A barcode already assigned to another active product must be rejected with a useful message.
- Do not allow deletion of a product referenced by transactions. Offer archive/deactivate instead; retain transaction history.
- Stock quantity must not be edited as an ordinary product field. Corrections use a stock adjustment/count workflow with reason, permissions, audit record, and stock movement ledger.
- Changing a unit conversion while stock exists requires a controlled, audited workflow so quantities and valuation remain consistent.
- Unsaved edits should trigger a confirmation before navigating away. Validate inputs inline and show clear save success/failure feedback.

## 4. Inventory user experience

- Inventory list supports fast search by name, SKU, barcode, and category; sorting, filtering, pagination/virtualization, and clear stock/status indicators.
- Product details/edit screen groups information logically: General, Barcodes, Pricing, Units & Packaging, Stock Rules, Tax, Supplier, and History.
- Provide a clear Edit action and a save/cancel flow. Show the current price and the proposed new price before saving a price change.
- Show a product activity/history panel for price changes, stock movements, adjustments, purchasing, and other important changes according to permissions.
- Bulk price updates may be supported later, but must preview affected items, require confirmation, validate all rows, and produce an audit trail.

## 5. Acceptance tests

- UX-001: All major screens use the same design tokens and reusable component styles.
- UX-002: Buttons and transitions feel immediate and do not block scanning or checkout.
- UX-003: Large inventory/product lists remain responsive under a representative load test.
- UX-004: Reduced-motion settings are respected.
- INV-EDIT-001: Authorized user can edit an existing product and persist the changes after restart.
- INV-EDIT-002: Selling-price update affects future sales only; prior sale lines and receipts remain unchanged.
- INV-EDIT-003: Purchase cost changes preserve posted historical purchase and accounting records.
- INV-EDIT-004: Duplicate SKU/barcode is rejected with a clear validation message.
- INV-EDIT-005: Product with transaction history can be deactivated but cannot be hard-deleted.
- INV-EDIT-006: Stock quantity corrections require a stock adjustment/count transaction and reason.
- INV-EDIT-007: Every important edit records actor, timestamp, changed values, and reason where required.
- INV-EDIT-008: Unsafe base-unit or tracking-method changes are blocked or routed through a controlled workflow.
