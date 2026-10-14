const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const executablePath = path.resolve(__dirname, '../../release/linux-unpacked/nouvo-pos-cash-carry');
const username = 'smoke.owner';
const password = 'Smoke-Test-Password-2026!';

async function launch(home) {
  const app = await electron.launch({
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
  page.on('pageerror', (error) => console.error('RENDERER_PAGE_ERROR:', error.message));
  return { app, page };
}

async function main() {
  if (!fs.existsSync(executablePath)) throw new Error('Packaged Linux executable was not found.');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nouvo-auth-smoke-'));
  let app;
  try {
    // First launch: initial owner setup must succeed.
    let opened = await launch(home);
    app = opened.app;
    let page = opened.page;
    await page.getByRole('heading', { name: 'Create your owner account' }).waitFor();
    await page.locator('input[autocomplete="name"]').fill('Smoke Test Owner');
    await page.locator('input[autocomplete="username"]').fill(username);
    const newPasswords = page.locator('input[autocomplete="new-password"]');
    await newPasswords.nth(0).fill(password);
    await newPasswords.nth(1).fill(password);
    await page.getByRole('button', { name: 'Show password' }).click();
    if ((await newPasswords.nth(0).getAttribute('type')) !== 'text')
      throw new Error('Password eye toggle did not reveal the password.');
    await page.getByRole('button', { name: 'Hide password' }).click();
    if ((await newPasswords.nth(0).getAttribute('type')) !== 'password')
      throw new Error('Password eye toggle did not hide the password.');
    await page.getByRole('button', { name: /Create owner and open POS/ }).click();
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    console.log('PASS first-run owner signup, password visibility toggle, and dashboard redirect');
    await app.close();
    app = undefined;

    // Second launch: owner record must persist and sign-in must work.
    opened = await launch(home);
    app = opened.app;
    page = opened.page;
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
    const loginPassword = page.locator('input[autocomplete="current-password"]');
    await loginPassword.fill(password);
    await page.getByRole('button', { name: 'Show password' }).click();
    if ((await loginPassword.getAttribute('type')) !== 'text')
      throw new Error('Login password eye toggle did not reveal the password.');
    await page.getByRole('button', { name: 'Hide password' }).click();
    if ((await loginPassword.getAttribute('type')) !== 'password')
      throw new Error('Login password eye toggle did not hide the password.');
    if ((await page.locator('.auth-form .inventory-field > span').count()) !== 0)
      throw new Error('Required-field stars are still visible on the login form.');
    await page.locator('input[autocomplete="username"]').fill('  SMOKE.OWNER  ');
    await page.locator('input[autocomplete="current-password"]').fill('Definitely-Wrong-Password!');
    await page.getByRole('button', { name: /Sign in securely/ }).click();
    await page
      .getByRole('alert')
      .getByText('Invalid username or password, or this account is disabled.')
      .waitFor();
    console.log('PASS incorrect password rejected with visible error');
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole('button', { name: /Sign in securely/ }).click();
    await page.getByRole('heading', { name: 'Good to see you.' }).waitFor();
    console.log('PASS correct sign-in after app restart using persisted local database');
    await app.close();
    app = undefined;
    console.log('PASS complete authentication smoke test');
  } finally {
    if (app) await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
