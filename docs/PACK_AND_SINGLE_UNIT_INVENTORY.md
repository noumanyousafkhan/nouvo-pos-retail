# Pack and Single-Unit Inventory

## Model

- `packSize` defines how many individual units are in one sale pack.
- `singleUnitName` defines the name shown for one individual unit (for example, `cigarette`, `tablet`, or `piece`).
- `sellingPriceMinor` is the price of one full pack when `packSize > 1`.
- `singleSellingPriceMinor` is optional. If it is `null`, single-unit sales remain disabled until an owner sets a price.
- Pack barcodes continue to identify the full pack. Individual units do not require their own barcode; the cashier can add them from the product tile/search.

## Stock and accounting

Stock is ledgered in pack-equivalent milli-units: `1000` means one pack. A single-unit sale converts the sold quantity into the exact pack-equivalent delta. With 20 units per pack, one single unit is `50` milli-pack units. Stock movements, weighted-average pack cost, COGS, returns, counter allocations, and sync payloads use the pack-equivalent delta, while sale lines preserve the selling quantity, unit label, and pack-size snapshot.

Pack sizes must divide 1,000 so each single-unit movement is exact at the current stock precision. Examples include 10, 20, 25, and 50. Do not round a single-unit stock conversion; reject unsupported pack sizes instead.

## Checkout

- Barcode scan or normal product selection adds one full pack.
- A separate single-unit action appears when `packSize > 1`.
- The single action is disabled until a single-unit price is configured.
- Quantities for individual units must be whole numbers.
- The cart checks combined pack and single quantities against the same stock balance.
- Sale and return records snapshot the sale unit and pack size so later product edits do not change historical return conversion.

## Stock adjustments

Receiving supplier stock is done in packs. Manual adjustments and write-offs can be recorded in packs or individual units. A single-unit adjustment must be a whole number; negative stock is rejected, and every movement retains its reason, actor/audit event, accounting posting, and sync outbox event.

## Product maintenance and deletion

Pack size, single-unit label, pack price, and optional single-unit price are editable. Pack size can be changed while stock is in whole packs and no individual-unit sales exist. The system blocks pack-size changes when a partial pack remains or individual-unit sales have occurred, because changing the conversion would otherwise distort stock and historical returns. For a different package size after that point, archive the old product and create a new product. Product deletion is allowed only for an unused product with zero stock and no stock/purchase/sales history or acknowledged central-sync event. Otherwise, archive the product so reports, receipts, accounting, and audit history remain intact.

## Adding the cigarette catalogue

The initial cigarette catalogue uses 20 units per pack, `pack` as the inventory unit, `cigarette` as the single-unit label, the supplied barcode on the full pack, and no single-unit price until it is explicitly configured. Each initial quantity of 10 means 10 full packs, not 10 individual cigarettes.
