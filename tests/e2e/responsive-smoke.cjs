const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const project = '/home/nouman/Documents/Cash and Carry POS';
  const executablePath = path.join(project, 'release/linux-unpacked/nouvo-pos-cash-carry');
  if (!fs.existsSync(executablePath)) throw new Error('Packaged Linux executable missing');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvo-responsive-'));
  let app;
  try {
    app = await electron.launch({
      executablePath,
      args: ['--no-sandbox', '--disable-gpu', '--ozone-platform=x11'],
      env: { ...process.env, HOME: home, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' },
      timeout: 30000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('heading', { name: 'Create your owner account' }).waitFor();
    await page.locator('input[autocomplete="name"]').fill('Responsive Test Owner');
    await page.locator('input[autocomplete="username"]').fill('responsive.owner');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(0)
      .fill('Responsive-Test-Password-2026!');
    await page
      .locator('input[autocomplete="new-password"]')
      .nth(1)
      .fill('Responsive-Test-Password-2026!');
    await page.getByRole('button', { name: /Create owner and open POS/ }).click();
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    const sizes = [
      { width: 800, height: 600 },
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
    ];
    const views = [
      'Dashboard',
      'Inventory',
      'Checkout',
      'Cashier shifts',
      'Accounting',
      'Reports',
      'Synchronization',
      'Settings',
      'Branding',
    ];
    for (const size of sizes) {
      await page.setViewportSize(size);
      for (const name of views) {
        const link = page.locator('.sidebar-nav .nav-link').filter({ hasText: name });
        if (!(await link.count())) continue;
        await link.first().click();
        await page.waitForTimeout(120);
        const metrics = await page.evaluate(() => ({
          viewport: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
        }));
        if (Math.max(metrics.documentWidth, metrics.bodyWidth) - metrics.viewport > 2) {
          throw new Error(
            'Horizontal overflow at ' +
              size.width +
              'x' +
              size.height +
              ' on ' +
              name +
              ': ' +
              JSON.stringify(metrics),
          );
        }
        console.log(
          'PASS responsive ' +
            size.width +
            'x' +
            size.height +
            ' — ' +
            name +
            ' — no horizontal overflow',
        );
      }
    }
    if (errors.length) throw new Error('Renderer errors: ' + errors.join('; '));
    console.log('PASS all responsive viewport checks');
  } finally {
    if (app) await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
