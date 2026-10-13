# Accounting policy and posting matrix — Release 1 foundation

**Status:** Local immutable double-entry ledger foundation. Account mapping, tax treatment, inventory costing and supplier-liability policy still require business-owner/accountant approval before real financial use.

## Currency and rounding

- Currency amounts use integer minor units; quantities use thousandths of a product's base unit.
- Every journal must balance exactly in minor units. Posting is rejected when debits and credits differ.
- Existing line-level tax and weighted-average purchase cost calculations use integer arithmetic and explicit rounding.
- Sales use persisted sale/payment/stock snapshots. Later product-price changes do not rewrite posted entries.

## Default chart of accounts

| Code | Account                                               | Type           | Normal balance |
| ---- | ----------------------------------------------------- | -------------- | -------------- |
| 1000 | Cash on Hand                                          | Asset          | Debit          |
| 1010 | Legacy Non-cash Payment Clearing (historical entries) | Asset          | Debit          |
| 1011 | Card Payment Clearing                                 | Asset          | Debit          |
| 1012 | Bank Transfer Clearing                                | Asset          | Debit          |
| 1013 | Mobile Wallet Clearing                                | Asset          | Debit          |
| 1019 | Other Payment Clearing                                | Asset          | Debit          |
| 1200 | Inventory                                             | Asset          | Debit          |
| 2000 | Accounts Payable                                      | Liability      | Credit         |
| 3000 | Opening Stock / Capital Adjustment                    | Equity         | Credit         |
| 2100 | Sales Tax Payable                                     | Liability      | Credit         |
| 4000 | Sales Revenue                                         | Income         | Credit         |
| 4090 | Stock Adjustment Gain                                 | Income         | Credit         |
| 4050 | Sales Returns and Allowances                          | Contra-revenue | Debit          |
| 5000 | Cost of Goods Sold                                    | Expense        | Debit          |
| 5010 | Inventory Shrinkage and Write-off                     | Expense        | Debit          |

## Posting matrix

| Source event                    | Debit                                                                                               | Credit                                                                           | Notes                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Completed sale                  | Cash on Hand for cash; method-specific card, bank-transfer, mobile-wallet or other clearing account | Sales Revenue for net-of-tax sale amount; Sales Tax Payable for tax              | Cash applied to the sale is used, not amount tendered; change due is excluded from drawer increase.                      |
| Sale return or void             | Sales Returns and Allowances for refund excluding tax; Sales Tax Payable for tax refunded           | Cash on Hand for cash refund; matching payment-method clearing account otherwise | Inventory is debited and COGS credited for returned quantities at the original recorded unit cost.                       |
| Goods received                  | Inventory                                                                                           | Accounts Payable                                                                 | Received supplier invoice is recorded as a liability; invoice-level supplier payments debit AP and credit cash/clearing. |
| Supplier return                 | Accounts Payable                                                                                    | Inventory                                                                        | Return is limited to received quantity still on hand; zero-value returns have no monetary journal.                       |
| Supplier payment                | Accounts Payable                                                                                    | Cash (cash) / Non-cash Clearing (other methods)                                  | Payment is linked to a received invoice and cannot exceed its remaining balance.                                         |
| Manual stock receipt            | Inventory                                                                                           | Opening Stock / Capital Adjustment                                               | Stock receipt is atomic with its balanced journal; cost uses supplied cost or current weighted-average cost.             |
| Positive adjustment             | Inventory                                                                                           | Stock Adjustment Gain                                                            | Positive physical-count corrections use average cost unless a unit cost is supplied.                                     |
| Negative adjustment / write-off | Inventory Shrinkage and Write-off                                                                   | Inventory                                                                        | Reduction is valued from the movement cost snapshot and cannot reduce stock below zero.                                  |

## Ledger invariants

- Journal source is unique per store, source type and source ID; retries cannot post duplicate journals.
- Business event and journal posting run in the same SQLite transaction.
- Every line is exactly one-sided (debit or credit); zero-sided lines and lines with both sides populated are rejected.
- Posting validates that total debits equal total credits before persistence.
- Posted rows are not edited by these workflows; manual journal corrections use a separate balanced reversing entry with a required reason and audit trail.

## Not yet covered

Payment processor settlement, discounts, full investing/financing classification for the indirect-method cash-flow statement, and accountant-approved tax/reporting rules. Manual stock receipt/adjustment/write-off journals, manual journals/reversals, supplier returns, a posted-ledger balance sheet with retained earnings, direct cash/clearing movement summary, and indirect operating-cash-flow reconciliation are implemented. The balance sheet exposes an out-of-balance flag rather than masking discrepancies. Weighted-average costing is updated on supplier receipts and manual goods receipts and is snapshotted into sale/stock movements. Reconciliation between stock-value estimates and the posted inventory account still requires accountant/data acceptance on real store data. Non-cash sales/refunds and supplier payments now use method-specific clearing accounts; legacy 1010 is retained only for historical entries. The default account mappings and all tax assumptions require sign-off before production financial use.
