# NOUVO POS Cash & Carry 0.2.1

Date: 2026-10-14

## Changes

- Added method-specific accounting clearing accounts for card, bank transfer, mobile wallet and other payments.
- Kept legacy non-cash account 1010 for historic journal entries while routing new transactions to method-specific accounts.
- Applied the same account mapping to customer refunds and supplier payments.
- Expanded cash/clearing movement reporting to include all clearing accounts.
- Added regression coverage for checkout and supplier settlement mappings.

## Verification

- 71 automated unit/service tests passed.
- TypeScript typecheck, ESLint, Prettier and packaged Linux E2E passed.
- Windows NSIS installer, Linux AppImage and Debian package rebuilt; archive and checksum verification is performed separately.

## Known release gates

This is not a claim of 100% production acceptance. Perpetual inventory valuation and adjustment journals, full indirect cash-flow reporting, accountant approval, physical printer acceptance, and real operating-system install/upgrade/data-preservation tests remain open.
