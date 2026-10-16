const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const executablePath = path.join(root, 'release/linux-unpacked/nouvo-pos-cash-carry');
  if (!fs.existsSync(executablePath)) throw new Error('Build the packaged Linux app first.');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvo-unit-e2e-'));
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-gpu', '--ozone-platform=x11'],
      env: { ...process.env, HOME: home },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByRole('heading', { name: 'Create your owner account' }).waitFor();
    await page.locator('input[autocomplete="name"]').fill('Unit QA Owner');
    await page.locator('input[autocomplete="username"]').fill('unit.qa.owner');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(0)
      .fill('QA-Temporary-Password-2026!');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(1)
      .fill('QA-Temporary-Password-2026!');
    await page.getByRole('button', { name: /Create owner and open POS/ }).click();
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    await page.locator('.sidebar-nav .nav-link').filter({ hasText: 'Inventory' }).click();
    await page
      .getByRole('button', { name: /Add product/ })
      .first()
      .click();
    const form = page.getByRole('dialog', { name: /Add product/ });
    await form.locator('input[placeholder="e.g. Basmati Rice 5kg"]').fill('Capstan QA Pack');
    await form.locator('input[placeholder="Optional unique code"]').fill('CAPSTAN-QA');
    await form.locator('input[placeholder="e.g. Grocery"]').fill('Cigarettes');
    await form.locator('input[placeholder="piece, kg, pack"]').fill('pack');
    await form.getByLabel(/Units per pack/).fill('20');
    await form.getByLabel(/Name of one unit/).fill('cigarette');
    await form.getByLabel(/Single-unit selling price/).fill('15');
    await form.getByLabel(/Purchase cost/).fill('236.30');
    await form.getByLabel(/^Selling price/).fill('250');
    await form.locator('textarea[placeholder="Scan or type barcode values"]').fill('896018849991');
    await form.getByRole('button', { name: 'Create product' }).click();
    await page.getByRole('status').getByText('Product created successfully.').waitFor();
    let product = await page.evaluate(
      async () => (await window.nouvo.listProducts({ search: 'CAPSTAN-QA' }))[0],
    );
    if (product.singleSellingPriceMinor !== 1500)
      throw new Error('Single price save failed: ' + JSON.stringify(product));
    const row = page.locator('.inventory-table tbody tr').filter({ hasText: 'Capstan QA Pack' });
    await row.getByRole('button', { name: 'Stock' }).click();
    const stock = page.getByRole('dialog', { name: /Update stock/ });
    if (!(await stock.locator('select').nth(1).isDisabled()))
      throw new Error('Receipt unit selector should be pack-only.');
    await stock.locator('input[type="number"]').nth(0).fill('10');
    await stock.locator('input[type="number"]').nth(1).fill('236.30');
    await stock.locator('textarea').fill('QA full-pack receipt');
    await stock.getByRole('button', { name: 'Save stock movement' }).click();
    await page
      .getByRole('status')
      .getByText(/Stock saved/)
      .waitFor();
    await row.getByRole('button', { name: 'Stock' }).click();
    const adjust = page.getByRole('dialog', { name: /Update stock/ });
    await adjust.locator('select').nth(0).selectOption('adjustment');
    await adjust.locator('select').nth(1).selectOption('single');
    await adjust.locator('input[type="number"]').fill('-1');
    await adjust.locator('textarea').fill('QA remove one cigarette');
    await adjust.getByRole('button', { name: 'Save stock movement' }).click();
    await page
      .getByRole('status')
      .getByText(/Stock saved/)
      .waitFor();
    product = await page.evaluate(
      async () => (await window.nouvo.listProducts({ search: 'CAPSTAN-QA' }))[0],
    );
    if (product.stockOnHandMilli !== 9950)
      throw new Error('Single-unit adjustment failed: ' + product.stockOnHandMilli);
    console.log(
      'PASS single price saves and quantity-unit selector deducts one cigarette correctly',
    );
    await page.locator('.sidebar-nav .nav-link').filter({ hasText: 'Cashier shifts' }).click();
    await page.getByRole('heading', { name: 'Cashier shifts' }).waitFor();
    await page.getByLabel('Starting cash in drawer').fill('1000');
    await page.getByLabel('Note (optional)').fill('Pack/single QA float');
    await page.getByRole('button', { name: 'Open cashier shift' }).click();
    await page.getByText('Cashier shift opened. Checkout and refunds are now enabled.').waitFor();
    await page.getByRole('link', { name: 'Checkout' }).click();
    const single = page
      .locator('.checkout-product-card')
      .filter({ hasText: 'Capstan QA Pack' })
      .getByRole('button', { name: /\+ Single.*15/ });
    await single.waitFor();
    if (await single.isDisabled())
      throw new Error('Single-cigarette sale disabled despite configured price and stock.');
    await single.click();
    await page.getByRole('button', { name: /Continue to payment/ }).click();
    await page.getByRole('heading', { name: 'Take payment' }).waitFor();
    await page.getByRole('button', { name: 'Complete sale' }).click();
    await page.getByRole('button', { name: 'New sale' }).waitFor();
    product = await page.evaluate(
      async () => (await window.nouvo.listProducts({ search: 'CAPSTAN-QA' }))[0],
    );
    if (product.stockOnHandMilli !== 9900)
      throw new Error(
        'Single sale did not deduct exactly one cigarette: ' + product.stockOnHandMilli,
      );
    if (errors.length) throw new Error(errors.join('; '));
    console.log('PASS checkout sells one cigarette for Rs 15 and deducts exactly one unit');
  } finally {
    if (app) await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
