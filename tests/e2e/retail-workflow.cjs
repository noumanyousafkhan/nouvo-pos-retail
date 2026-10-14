const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const project = path.resolve(__dirname, '../..');
  const executablePath = path.join(project, 'release/linux-unpacked/nouvo-pos-cash-carry');
  if (!fs.existsSync(executablePath)) throw new Error('Packaged Linux executable was not found.');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvo-retail-e2e-'));
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-gpu',
        '--ozone-platform=x11',
        '--disable-features=WaylandWindowDecorations',
      ],
      env: { ...process.env, HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const rendererErrors = [];
    page.on('pageerror', (error) => rendererErrors.push(error.message));
    await page.getByRole('heading', { name: 'Create your owner account' }).waitFor();
    if ((await page.locator('.auth-form .inventory-field > span').count()) !== 0)
      throw new Error('Required-field stars are still visible on the owner setup form.');
    await page.locator('input[autocomplete="name"]').fill('Retail Workflow Owner');
    await page.locator('input[autocomplete="username"]').fill('retail.owner');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(0)
      .fill('Retail-Workflow-Password-2026!');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(1)
      .fill('Retail-Workflow-Password-2026!');
    await page.getByRole('button', { name: 'Show password' }).click();
    if (
      (await page.locator('input[autocomplete="new-password"]').nth(0).getAttribute('type')) !==
      'text'
    )
      throw new Error('Setup password reveal failed.');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await page.getByRole('button', { name: /Create owner and open POS/ }).click();
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    await page.locator('.sidebar-nav .nav-link').filter({ hasText: 'Branding' }).click();
    await page.getByRole('heading', { name: 'Branding', exact: true }).waitFor();
    await page.getByLabel(/Business \/ shop name/).fill('Retail E2E Demo Shop');
    await page.getByLabel('Business address').fill('123 Test Market Road');
    await page.getByLabel('Phone number').fill('03001234567');
    await page.getByRole('button', { name: 'Save business identity' }).click();
    await page.getByRole('status').getByText('Business identity saved successfully.').waitFor();
    const savedBusiness = await page.evaluate(() => window.nouvo.getBusinessSettings());
    if (
      savedBusiness.name !== 'Retail E2E Demo Shop' ||
      savedBusiness.address !== '123 Test Market Road' ||
      savedBusiness.phone !== '03001234567'
    )
      throw new Error(
        `Business settings did not persist without creating a staff account: ${JSON.stringify(savedBusiness)}`,
      );
    console.log('PASS business settings save and persist while all staff-account fields are empty');
    await page.locator('.sidebar-nav .nav-link').filter({ hasText: 'Inventory' }).click();
    await page.getByRole('heading', { name: 'Inventory' }).waitFor();
    await page
      .getByRole('button', { name: /Add product/ })
      .first()
      .click();
    const productDialog = page.getByRole('dialog', { name: /Add product/ });
    await productDialog
      .locator('input[placeholder="e.g. Basmati Rice 5kg"]')
      .fill('Retail E2E Item 01');
    await productDialog.locator('input[placeholder="Optional unique code"]').fill('RETAIL-E2E-001');
    await productDialog.locator('input[placeholder="e.g. Grocery"]').fill('Grocery');
    await productDialog.locator('input[placeholder="piece, kg, pack"]').fill('piece');
    await productDialog.locator('input[type="number"]').nth(0).fill('0');
    await productDialog.locator('input[type="number"]').nth(1).fill('5.00');
    await productDialog.locator('input[type="number"]').nth(2).fill('11.00');
    await productDialog
      .locator('textarea[placeholder="Scan or type barcode values"]')
      .fill('990000000001');
    await productDialog
      .locator('textarea[placeholder="Optional product details"]')
      .fill('Retail E2E description field check');
    await productDialog.getByRole('button', { name: 'Create product' }).click();
    await page.getByRole('status').getByText('Product created successfully.').waitFor();
    const firstProductRow = page
      .locator('.inventory-table tbody tr')
      .filter({ hasText: 'Retail E2E Item 01' });
    await firstProductRow.getByRole('button', { name: 'Stock' }).click();
    const stockDialog = page.getByRole('dialog', { name: /Update stock/ });
    await stockDialog.locator('input[type="number"]').nth(0).fill('10');
    await stockDialog.locator('input[type="number"]').nth(1).fill('5.00');
    await stockDialog.locator('textarea').fill('Automated UI initial stock receipt');
    await stockDialog.getByRole('button', { name: 'Save stock movement' }).click();
    await page
      .getByRole('status')
      .getByText(/Stock saved. New on-hand: 10 piece/)
      .waitFor();

    const inventory = await page.evaluate(async () => {
      for (let i = 2; i <= 12; i++) {
        const product = await window.nouvo.saveProduct({
          name: `Retail E2E Item ${String(i).padStart(2, '0')}`,
          categoryName: i <= 4 ? 'Grocery' : i <= 8 ? 'Household' : 'Personal Care',
          sku: `RETAIL-E2E-${String(i).padStart(3, '0')}`,
          barcodes: [`990000000${String(i).padStart(3, '0')}`],
          baseUnit: 'piece',
          purchaseCostMinor: 500,
          sellingPriceMinor: 1000 + i * 100,
          taxRateBasisPoints: 0,
        });
        await window.nouvo.recordStockMovement({
          productId: product.id,
          movementType: 'receipt',
          quantityMilli: 10000,
          unitCostMinor: 500,
          reason: 'Automated retail workflow initial stock',
        });
      }
      const listed = await window.nouvo.listProducts({ search: 'Retail E2E Item' });
      if (
        listed.length !== 12 ||
        listed.some((p) => p.stockOnHandMilli !== 10000 && p.name !== 'Retail E2E Item 01')
      )
        throw new Error(`Inventory verification failed: ${listed.length} products returned.`);
      if (listed.find((p) => p.name === 'Retail E2E Item 01')?.stockOnHandMilli !== 10000)
        throw new Error('UI-created product stock was not received correctly.');
      return listed.length;
    });
    console.log(
      `PASS create one product through every UI field, receive its stock through the UI, and seed ${inventory - 1} more items across three categories`,
    );
    const inventorySearch = page.getByLabel('Search products');
    await inventorySearch.fill('9900000000');
    await page.waitForFunction(
      () => document.querySelectorAll('.inventory-table tbody tr').length === 12,
    );
    if ((await page.locator('.inventory-table tbody tr').count()) !== 12)
      throw new Error('Inventory search did not update live with partial barcode matches.');
    await inventorySearch.fill('990000000001');
    await page.waitForFunction(
      () => document.querySelectorAll('.inventory-table tbody tr').length === 1,
    );
    if ((await page.locator('.inventory-table tbody tr').count()) !== 1)
      throw new Error('Exact barcode search did not narrow inventory to the matching product.');
    await inventorySearch.fill('990000000');
    await page.waitForFunction(
      () => document.querySelectorAll('.inventory-table tbody tr').length === 12,
    );
    if ((await page.locator('.inventory-table tbody tr').count()) !== 12)
      throw new Error('Removing barcode characters did not expand the live search results.');
    await inventorySearch.fill('');
    await page.waitForFunction(
      () => document.querySelectorAll('.inventory-table tbody tr').length === 12,
    );
    console.log(
      'PASS inventory search updates while typing, narrows exact barcode, and expands when characters are removed',
    );
    await page.getByRole('link', { name: 'Checkout' }).click();
    await page.getByRole('heading', { name: 'Checkout' }).waitFor();
    await page.getByRole('button', { name: /Retail E2E Item 01/ }).click();
    const blockedPaymentButton = page.getByRole('button', { name: /Continue to payment/ });
    if (!(await blockedPaymentButton.isDisabled()))
      throw new Error('Checkout allowed payment without an open cashier shift.');
    await page
      .getByRole('alert')
      .getByText(/Open a cashier shift before taking payments/)
      .waitFor();
    await page.getByRole('link', { name: /Open cashier shift/ }).click();
    await page.getByRole('heading', { name: 'Cashier shifts' }).waitFor();
    await page.getByRole('heading', { name: 'No open shift' }).waitFor();
    const openingFloatInput = page.getByLabel('Starting cash in drawer');
    await openingFloatInput.fill('5000.00');
    await openingFloatInput.hover();
    await page.mouse.wheel(0, -600);
    if ((await openingFloatInput.inputValue()) !== '5000.00')
      throw new Error('Scrolling over a number input unexpectedly changed its value.');
    await page.getByLabel('Note (optional)').fill('Automated morning float');
    await page.getByRole('button', { name: 'Open cashier shift' }).click();
    await page.getByText('Cashier shift opened. Checkout and refunds are now enabled.').waitFor();
    await page.getByText('OPEN', { exact: true }).waitFor();
    console.log('PASS open cashier shift through the UI and confirm it is active');
    await page.getByRole('link', { name: 'Checkout' }).click();
    await page.getByRole('heading', { name: 'Checkout' }).waitFor();
    const receipts = [];
    for (let i = 1; i <= 5; i++) {
      const productName = `Retail E2E Item ${String(i).padStart(2, '0')}`;
      await page.getByRole('button', { name: new RegExp(productName) }).click();
      const continueButton = page.getByRole('button', { name: /Continue to payment/ });
      if (await continueButton.isDisabled())
        throw new Error('Continue to payment is disabled despite an open shift and stocked cart.');
      await continueButton.click();
      await page.getByRole('heading', { name: 'Take payment' }).waitFor();
      await page.getByRole('button', { name: 'Complete sale' }).click();
      await page.getByRole('button', { name: 'New sale' }).waitFor();
      await page.getByRole('button', { name: 'New sale' }).click();
      await page.getByText(/saved successfully/).waitFor();
      receipts.push(productName);
    }
    const verified = await page.evaluate(async () => {
      const products = await window.nouvo.listProducts({ search: 'Retail E2E Item' });
      const active = await window.nouvo.getActiveCashierSession();
      return {
        productCount: products.length,
        stockForFirstFive: products
          .filter((p) => /Retail E2E Item 0[1-5]/.test(p.name))
          .map((p) => ({ name: p.name, stock: p.stockOnHandMilli })),
        activeStatus: active?.status,
        cashSalesMinor: active?.cashSalesMinor,
        expectedCashMinor: active?.expectedCashMinor,
      };
    });
    if (
      verified.productCount !== 12 ||
      verified.activeStatus !== 'open' ||
      verified.cashSalesMinor !== 6500 ||
      verified.expectedCashMinor !== 506500
    )
      throw new Error(`Sales/shift reconciliation mismatch: ${JSON.stringify(verified)}`);
    if (verified.stockForFirstFive.some((p) => p.stock !== 9000))
      throw new Error(`Stock decrement mismatch: ${JSON.stringify(verified.stockForFirstFive)}`);
    if (rendererErrors.length)
      throw new Error(`Renderer errors detected: ${rendererErrors.join('; ')}`);
    console.log(
      'PASS five real checkout UI sales, receipt flow, stock decrement and cashier cash reconciliation',
    );
    console.log('PASS no renderer errors during signup, inventory, shift opening and five sales');
  } finally {
    if (app) await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
