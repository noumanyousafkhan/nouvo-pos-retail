# Accounting policy and posting matrix — Release 1 foundation

**Status:** Local immutable double-entry ledger foundation. Account mapping, tax treatment, inventory costing and supplier-liability policy still require business-owner/accountant approval before real financial use.

## Currency and rounding

- Currency amounts use integer minor units; quantities use thousandths of a product's base unit.
- Every journal must balance exactly in minor units. Posting is rejected when debits and credits differ.
- Existing line-level tax and weighted-average purchase cost calculations use integer arithmetic and explicit rounding.
- Sales use persisted sale/payment/stock snapshots. Later product-price changes do not rewrite posted entries.

## Default chart of accounts

| Code | Account                      | Type           | Normal balance |
| ---- | ---------------------------- | -------------- | -------------- |
| 1000 | Cash on Hand                 | Asset          | Debit          |
| 1010 | Non-cash Payment Clearing    | Asset          | Debit          |
| 1200 | Inventory                    | Asset          | Debit          |
| 2000 | Accounts Payable             | Liability      | Credit         |
| 2100 | Sales Tax Payable            | Liability      | Credit         |
| 4000 | Sales Revenue                | Income         | Credit         |
| 4050 | Sales Returns and Allowances | Contra-revenue | Debit          |
| 5000 | Cost of Goods Sold           | Expense        | Debit          |

## Posting matrix

| Source event        | Debit                                                                                     | Credit                                                              | Notes                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Completed sale      | Cash on Hand for cash; Non-cash Payment Clearing for other payment methods                | Sales Revenue for net-of-tax sale amount; Sales Tax Payable for tax | Cash applied to the sale is used, not amount tendered; change due is excluded from drawer increase. |
| Sale return or void | Sales Returns and Allowances for refund excluding tax; Sales Tax Payable for tax refunded | Cash on Hand for cash refund; Non-cash Payment Clearing otherwise   | Inventory is debited and COGS credited for returned quantities at the original recorded unit cost.  |
| Goods received      | Inventory                                                                                 | Accounts Payable                                                    | Supplier invoice is recorded as a liability; supplier payment settlement is not yet implemented.    |

## Ledger invariants

- Journal source is unique per store, source type and source ID; retries cannot post duplicate journals.
- Business event and journal posting run in the same SQLite transaction.
- Every line is exactly one-sided (debit or credit); zero-sided lines and lines with both sides populated are rejected.
- Posting validates that total debits equal total credits before persistence.
- Posted rows are not edited by these workflows; corrections require a separate reversing-entry workflow that is not yet implemented.

## Not yet covered

Manual journals and reversals, supplier payments/aging, payment processor settlement, purchase returns, discounts, payment-method-specific clearing accounts, inventory adjustments, financial statements, and accountant-approved tax/reporting rules. Weighted-average costing is provisional: the existing product cost field is a current average estimate, not yet a full perpetual valuation ledger. The default account mappings and all tax assumptions require sign-off before production financial use.
