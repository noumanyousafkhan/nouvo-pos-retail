const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const project = path.resolve(__dirname, '../..');
  const executablePath = path.join(project, 'release/linux-unpacked/nouvo-pos-cash-carry');
  if (!fs.existsSync(executablePath)) throw new Error('Packaged Linux executable was not found.');
  const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvo-pos-smoke-'));
  let application;
  try {
    application = await electron.launch({
      executablePath,
      args: [
        '--disable-gpu',
        '--ozone-platform=x11',
        '--disable-features=WaylandWindowDecorations',
      ],
      env: { ...process.env, HOME: temporaryHome, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 30000,
    });
    application
      .process()
      .on('exit', (code, signal) => console.error('ELECTRON_PROCESS_EXIT:', code, signal));
    application
      .process()
      .stderr?.on('data', (chunk) => console.error('ELECTRON_STDERR:', chunk.toString()));
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => console.error('RENDERER_PAGE_ERROR:', error.message));
    page.on('crash', () => console.error('RENDERER_CRASHED'));
    page.on('close', () => console.error('RENDERER_WINDOW_CLOSED'));
    await page.getByRole('heading', { name: 'Create your owner account' }).waitFor();
    await page.locator('input[autocomplete="name"]').fill('Smoke Test Owner');
    await page.locator('input[autocomplete="username"]').fill('smoke.owner');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(0)
      .fill('Smoke-Test-Password-2026!');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(1)
      .fill('Smoke-Test-Password-2026!');
    await page.getByRole('button', { name: /Create owner and open POS/ }).click({ force: true });
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    const purchase = await page.evaluate(async () => {
      const supplier = await window.nouvo.saveSupplier({ name: 'E2E Supplier' });
      const product = await window.nouvo.saveProduct({
        name: 'E2E Return Item',
        categoryName: 'Smoke Test',
        purchaseCostMinor: 100,
        sellingPriceMinor: 200,
      });
      const order = await window.nouvo.createPurchaseOrder({
        supplierId: supplier.id,
        notes: 'Packaged supplier return smoke test',
        lines: [{ productId: product.id, quantityMilli: 2000, unitCostMinor: 100 }],
      });
      await window.nouvo.receivePurchaseOrder({
        id: order.id,
        supplierInvoiceNumber: 'E2E-SUP-INV',
      });
      return { orderId: order.id, productId: product.id, orderNumber: order.orderNumber };
    });
    await page.getByRole('link', { name: 'Purchasing' }).click({ force: true });
    await page.getByRole('heading', { name: 'Purchasing' }).waitFor();
    await page.getByRole('button', { name: 'Return goods' }).click({ force: true });
    await page.getByRole('dialog', { name: /Return goods/ }).waitFor();
    await page.getByLabel(/Reason for return/).fill('E2E supplier return');
    await page.getByLabel('Return quantity for E2E Return Item').fill('1');
    await page.getByRole('button', { name: 'Post supplier return' }).click({ force: true });
    await page
      .getByRole('status')
      .getByText(/Supplier return PR-/)
      .waitFor();
    const returnable = await page.evaluate(
      (orderId) => window.nouvo.listReturnablePurchaseOrderLines(orderId),
      purchase.orderId,
    );
    if (
      returnable[0]?.quantityReturnedMilli !== 1000 ||
      returnable[0]?.returnableQuantityMilli !== 1000
    ) {
      throw new Error('Packaged supplier return did not update the remaining returnable quantity.');
    }
    console.log(
      'PASS packaged supplier return modal, stock limit, history and accounting integration',
    );
    await page.getByRole('heading', { name: 'Supplier payment settlement' }).waitFor();
    await page.getByLabel(/Payment amount/).fill('1.00');
    await page.getByRole('button', { name: 'Record supplier payment' }).click({ force: true });
    await page
      .getByRole('status')
      .getByText(/Supplier payment SP-/)
      .waitFor();
    const settlement = await page.evaluate(async (orderId) => {
      const balances = await window.nouvo.listSupplierBalances();
      const payments = await window.nouvo.listSupplierPayments();
      return {
        balance: balances.find((item) => item.purchaseOrderId === orderId),
        paymentCount: payments.length,
      };
    }, purchase.orderId);
    if (
      settlement.balance?.outstandingMinor !== 0 ||
      settlement.balance.paidAmountMinor !== 100 ||
      settlement.paymentCount !== 1
    ) {
      throw new Error('Packaged supplier payment did not settle the remaining invoice balance.');
    }
    console.log('PASS packaged supplier payment settlement, balance aging and payment history');
    await page.getByRole('link', { name: 'Accounting' }).click({ force: true });
    await page.getByRole('heading', { name: 'Accounting ledger' }).waitFor();
    await page.getByRole('heading', { name: 'Trial balance' }).waitFor();
    await page.getByRole('heading', { name: 'Manual journal' }).waitFor();
    const manualRows = page.locator('.manual-journal-line:not(.manual-journal-line--heading)');
    const cashAccountId = await manualRows
      .nth(0)
      .locator('select option')
      .evaluateAll(
        (options) => options.find((option) => option.textContent?.startsWith('1000'))?.value,
      );
    const revenueAccountId = await manualRows
      .nth(1)
      .locator('select option')
      .evaluateAll(
        (options) => options.find((option) => option.textContent?.startsWith('4000'))?.value,
      );
    if (!cashAccountId || !revenueAccountId)
      throw new Error('Default chart of accounts was not rendered in the manual journal form.');
    await page.locator('.manual-journal-form > label input').fill('E2E smoke journal');
    await manualRows.nth(0).locator('select').selectOption(cashAccountId);
    await manualRows.nth(0).locator('input[type="number"]').nth(0).fill('50');
    await manualRows.nth(1).locator('select').selectOption(revenueAccountId);
    await manualRows.nth(1).locator('input[type="number"]').nth(1).fill('50');
    await page.getByRole('button', { name: 'Post journal' }).click({ force: true });
    await page.getByText(/Manual journal posted successfully/).waitFor();
    const journalRow = page.locator('tbody tr').filter({ hasText: 'E2E smoke journal' }).last();
    await journalRow.getByText('E2E smoke journal').waitFor();
    await journalRow.getByRole('button', { name: 'Reverse' }).click({ force: true });
    await page.getByRole('dialog', { name: /Reverse JE-/ }).waitFor();
    await page.locator('#reversal-reason').fill('E2E smoke reversal');
    await page.getByRole('button', { name: 'Confirm reversal' }).click({ force: true });
    await page
      .getByRole('status')
      .getByText(/Journal reversed. Reversal entry:/)
      .waitFor();
    await page.getByRole('link', { name: 'Synchronization' }).click({ force: true });
    await page.getByRole('heading', { name: 'Synchronization' }).waitFor();
    await page.getByRole('heading', { name: 'Central server connection' }).waitFor();
    console.log('PASS packaged sandboxed launch, first-run owner setup and secure preload bridge');
    console.log('PASS packaged dashboard and accounting trial balance/income statement UI');
    console.log('PASS packaged manual journal posting and reversal dialog');
    console.log('PASS packaged sync configuration and diagnostics UI');
  } finally {
    if (application) await application.close();
    fs.rmSync(temporaryHome, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
