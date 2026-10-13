# NOUVO POS Cash & Carry — Business Branding Requirements

**Status:** Approved requirement addendum for the product SRS  
**Example business:** Nayyab Tuc Shop

## 1. Purpose

NOUVO POS must let each customer configure the POS with their own business identity. The software brand must remain separate from the shop's identity. The shop's details must appear on customer receipts wherever the corresponding fields are enabled and configured.

## 2. Settings UI

Add a dedicated **Settings → Business Branding** section. It must be accessible to an authorized owner/admin and work offline. Provide a live receipt preview and a Save/Cancel flow. Validate field lengths and image files; show clear errors instead of silently discarding values.

## 3. Business profile fields

All fields are optional except the business name, which should be required before final receipt setup. Support:

- Business / shop name (e.g. Nayyab Tuc Shop)
- Logo upload, with preview, replace, and remove actions
- Tagline / slogan
- Business type/category
- Address lines, area/city, state/province, postal code, and country
- Primary phone, alternate phone, WhatsApp number
- Email and website
- Tax identifiers such as NTN, STRN, or other jurisdiction-specific registration numbers
- Social media links (optional)
- Custom receipt header message and footer message
- Return / exchange policy
- Additional custom label/value rows (for details not covered by standard fields)

Do not force users to fill in fields that do not apply to their business. Do not print empty labels or blank rows for unset optional values.

## 4. Receipt behavior

- Print the configured shop logo (if supplied), business name, and enabled business details on receipts.
- Support both 58 mm and 80 mm thermal receipt widths, with wrapping and scaling that preserve legibility.
- Allow each supported optional field to be toggled on/off for receipt printing independently of whether its value is saved.
- Provide a receipt preview for each supported paper width before saving or printing.
- Place custom header text above sale details and footer/policy text after totals and payment information, according to the selected receipt layout.
- Avoid clipping, overlapping, or printing unsupported empty sections. Long addresses, contact details, and custom text must wrap safely.
- Include the branding on normal sales receipts and applicable reprints. Return/refund receipts should use the same current business identity and clearly identify the return/refund transaction.
- Keep the software's own product branding separate from the customer's business identity; never print NOUVO POS branding on customer receipts by default.

## 5. Offline and multi-counter behavior

- Persist the branding profile locally so receipts can be printed without internet access.
- In a multi-counter store, authorized counters must use the same store-level branding profile. Branding changes must propagate to counters when connected and be cached locally for offline use.
- If a counter is offline, it continues using its last successfully synchronized branding profile and clearly indicates that the profile may be outdated if a newer version is known.
- Store a version/revision and update timestamp for the profile so sync can resolve updates deterministically.
- Save a snapshot of the business identity/receipt configuration with each finalized sale or receipt record so historical reprints do not silently change when the owner edits branding later. Make the policy for reprints explicit in the UI: historical receipt reprint uses its saved snapshot; a new sale uses the latest locally available profile.
- Include the branding profile and uploaded logo in encrypted/securely handled backup and restore procedures, consistent with the application's backup design.

## 6. Permissions and validation

- Only authorized owner/admin roles may edit branding settings; cashier access is read-only or hidden according to permissions.
- Validate image type and size; accept common logo formats such as PNG and JPEG. Preserve aspect ratio and avoid stretching logos. Transparent PNG logos should be supported.
- Store uploaded assets locally using managed application storage, not an arbitrary external path that may disappear.
- Sanitize custom text for safe rendering and printing. Treat all user-provided text as data, never executable content.
- Keep an audit entry for profile changes: user, timestamp, and changed fields. Do not log passwords or other secrets.

## 7. Acceptance tests

- BR-001: Admin can save a profile for “Nayyab Tuc Shop” with logo, address, phone, and email.
- BR-002: Configured details and logo appear on a receipt; disabled and unset fields do not appear.
- BR-003: The preview and print layout work at both 58 mm and 80 mm widths without clipping or overlap.
- BR-004: A sale can be completed and its receipt printed with no internet connection.
- BR-005: Branding synchronizes to other counters after connectivity returns; offline counters continue using their last cached profile.
- BR-006: A branding edit does not alter the saved identity on an old receipt reprint.
- BR-007: Logo replace/remove actions work, invalid image files are rejected, and aspect ratio is preserved.
- BR-008: A cashier without branding permission cannot change the profile.
- BR-009: Backup and restore retain the profile and logo.
- BR-010: Profile changes create an audit entry.

## 8. Implementation note

Treat this as a store-level configuration, not a hard-coded tenant name. Do not hard-code “Nayyab Tuc Shop” or any sample business data into the application. Keep defaults neutral and allow each client to enter their own details.
