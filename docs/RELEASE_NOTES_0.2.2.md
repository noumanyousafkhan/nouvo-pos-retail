# NOUVO POS Cash & Carry 0.2.2

## Accounting and inventory hardening

- Manual stock receipts, stock adjustments and write-offs create balanced accounting journals atomically with their stock movements.
- Opening stock increases are offset to opening-stock/equity; positive count adjustments use stock-adjustment gain; reductions use inventory shrinkage/write-off expense.
- Accounting now includes an indirect operating cash-flow reconciliation using net income and changes in inventory, accounts payable, sales tax payable and opening-stock/equity entries.
- The reconciliation displays actual cash/clearing movement and any difference rather than hiding an imbalance.

## Verification

- Added regression tests for balanced manual stock movement journals and indirect cash-flow reconciliation for a taxable sale.
- Full unit/service test suite and TypeScript checks run before packaging.

## Still requires external acceptance

- Accountant approval of tax and posting policy.
- Investing/financing cash-flow classifications for accounts/transactions not currently represented by the standard chart.
- Actual Windows install/upgrade with existing-data preservation.
- Physical 58mm/80mm printer testing and production central-sync TLS/concurrency/recovery acceptance.
