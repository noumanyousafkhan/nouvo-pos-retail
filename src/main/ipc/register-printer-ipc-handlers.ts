import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { BrowserWindow, ipcMain } from 'electron';
import { ThermalReceiptSchema } from '../../shared/contracts/app';

const execFileAsync = promisify(execFile);
const channel = 'printer:print-thermal-receipt';
const linuxQueue = '80Series2';

function toAscii(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[₹]/g, 'Rs ')
    .replace(/[×]/g, 'x')
    .replace(/[−–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, '?');
}

function wrap(value: string, width: number): string[] {
  // Preserve intentional newlines entered in the receipt footer textarea.
  return value.split(/\r?\n/).flatMap((paragraph) => {
    const words = toAscii(paragraph).trim().split(/\s+/);
    if (!words[0]) return [''];
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      if (word.length > width) {
        if (current) lines.push(current);
        current = '';
        for (let i = 0; i < word.length; i += width) lines.push(word.slice(i, i + width));
      } else if (!current) current = word;
      else if (current.length + word.length + 1 <= width) current += ' ' + word;
      else {
        lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
    return lines;
  });
}

function buildEscPos(lines: string[], paperWidthMm: 58 | 80): Buffer {
  const width = paperWidthMm === 58 ? 32 : 48;
  const out: Buffer[] = [Buffer.from([27, 64, 27, 97, 0])];
  for (const raw of lines) {
    if (raw.startsWith('[[CENTER]]')) {
      out.push(Buffer.from([27, 97, 1]));
      for (const line of wrap(raw.slice(10), width)) out.push(Buffer.from(line + '\n', 'ascii'));
      out.push(Buffer.from([27, 97, 0]));
    } else if (raw === '[[RULE]]') {
      out.push(Buffer.from('-'.repeat(width) + '\n', 'ascii'));
    } else if (raw.startsWith('[[PAIR]]')) {
      const pair = raw.slice(8);
      const tab = pair.indexOf('\t');
      const label = toAscii(tab < 0 ? pair : pair.slice(0, tab));
      const amount = toAscii(tab < 0 ? '' : pair.slice(tab + 1));
      const left = label.slice(0, Math.max(0, width - amount.length - 1));
      out.push(
        Buffer.from(
          left + ' '.repeat(Math.max(1, width - left.length - amount.length)) + amount + '\n',
          'ascii',
        ),
      );
    } else {
      for (const line of wrap(raw, width)) out.push(Buffer.from(line + '\n', 'ascii'));
    }
  }
  // GS V 65 0: feed to the cutter position, then perform a full cut.
  out.push(Buffer.from([29, 86, 65, 0]));
  return Buffer.concat(out);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function receiptHtml(
  lines: string[],
  paperWidthMm: 58 | 80,
): { html: string; heightMicrons: number } {
  const columns = paperWidthMm === 58 ? 32 : 48;
  const blocks = lines.map((raw) => {
    if (raw === '[[RULE]]') return '<div class="rule"></div>';
    if (raw.startsWith('[[CENTER]]')) {
      const value = raw.slice(10);
      return `<div class="center">${escapeHtml(value)}</div>`;
    }
    if (raw.startsWith('[[PAIR]]')) {
      const pair = raw.slice(8);
      const tab = pair.indexOf(String.fromCharCode(9));
      const label = tab < 0 ? pair : pair.slice(0, tab);
      const amount = tab < 0 ? '' : pair.slice(tab + 1);
      return `<div class="pair"><span class="label">${escapeHtml(label)}</span><span class="amount">${escapeHtml(amount)}</span></div>`;
    }
    return `<div class="line">${escapeHtml(raw)}</div>`;
  });
  const estimatedRows = lines.reduce((total, raw) => {
    if (raw === '[[RULE]]') return total + 1;
    const value = raw.startsWith('[[CENTER]]')
      ? raw.slice(10)
      : raw.startsWith('[[PAIR]]')
        ? raw.slice(8).replace(String.fromCharCode(9), ' ')
        : raw;
    return (
      total + Math.max(1, ...value.split(/\r?\n/).map((part) => Math.ceil(part.length / columns)))
    );
  }, 0);
  const heightMm = Math.max(60, Math.min(1200, estimatedRows * 5 + 15));
  return {
    heightMicrons: Math.round(heightMm * 1000),
    html: `<!doctype html>
<html><head><meta charset="utf-8"><style>
@page { size: ${paperWidthMm}mm ${heightMm}mm; margin: 0; }
* { box-sizing: border-box; }
html, body { width: ${paperWidthMm}mm; margin: 0; padding: 0; background: #fff; color: #000; }
body { padding: 2mm; font: 9pt/1.25 Consolas, "Courier New", monospace; overflow-wrap: anywhere; }
.center { text-align: center; white-space: pre-wrap; margin: 0 0 1mm; }
.line { white-space: pre-wrap; min-height: 3.8mm; }
.rule { border-top: 1px dashed #000; height: 2mm; margin-top: 1mm; }
.pair { display: flex; justify-content: space-between; gap: 1mm; align-items: flex-start; min-height: 4mm; }
.label { flex: 1 1 auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.amount { flex: 0 0 auto; white-space: nowrap; }
</style></head><body>${blocks.join('')}</body></html>`,
  };
}

async function printWithWindowsDriver(
  lines: string[],
  paperWidthMm: 58 | 80,
): Promise<{ success: boolean; message: string }> {
  const printWindow = new BrowserWindow({
    show: false,
    width: paperWidthMm === 58 ? 230 : 310,
    height: 900,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  try {
    const { html, heightMicrons } = receiptHtml(lines, paperWidthMm);
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const printers = await printWindow.webContents.getPrintersAsync();
    if (printers.length === 0) {
      return {
        success: false,
        message: 'No Windows printer is installed. Install the printer driver and try again.',
      };
    }

    // Never silently send a receipt to the Windows default printer: that may be
    // an A4 laser printer. Select the installed thermal/receipt printer by its
    // system name, display name, or driver description.
    const thermalPrinter = printers.find((printer) =>
      /black\s*copper|rongta|bc[-\s]?88|thermal|receipt|pos[-\s]?(58|80)|xp[-\s]?80|80mm|58mm/i.test(
        [printer.name, printer.displayName, printer.description].filter(Boolean).join(' '),
      ),
    );
    if (!thermalPrinter) {
      const installedNames = printers
        .map((printer) => printer.displayName || printer.name)
        .filter(Boolean)
        .join(', ');
      return {
        success: false,
        message: `NOUVO POS could not identify the thermal receipt printer. Installed printers: ${installedNames}. Make sure the Black Copper/RONGTA printer driver is installed, then retry.`,
      };
    }

    return await new Promise((resolve) => {
      printWindow.webContents.print(
        {
          silent: true,
          deviceName: thermalPrinter.name,
          printBackground: false,
          margins: { marginType: 'none' },
          pageSize: { width: paperWidthMm * 1000, height: heightMicrons },
        },
        (success, failureReason) => {
          resolve(
            success
              ? {
                  success: true,
                  message: `Receipt sent to ${thermalPrinter.displayName || thermalPrinter.name}.`,
                }
              : {
                  success: false,
                  message: `Printing to ${thermalPrinter.displayName || thermalPrinter.name} failed: ${failureReason || 'Unknown print error'}. Check the printer driver and paper-size settings.`,
                },
          );
        },
      );
    });
  } catch (error) {
    return {
      success: false,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

export function registerPrinterIpcHandlers(): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const input = ThermalReceiptSchema.parse(raw);

    if (process.platform === 'win32') {
      return printWithWindowsDriver(input.lines, input.paperWidthMm);
    }

    if (process.platform !== 'linux') {
      return {
        success: false,
        message: 'Receipt printing is currently supported on Windows and Linux.',
      };
    }

    const dir = await mkdtemp(join(tmpdir(), 'nouvo-receipt-'));
    const file = join(dir, 'receipt.bin');
    try {
      await writeFile(file, buildEscPos(input.lines, input.paperWidthMm), { mode: 0o600 });
      const { stdout } = await execFileAsync('lp', ['-d', linuxQueue, '-o', 'raw', file], {
        timeout: 10000,
        maxBuffer: 2048,
      });
      return { success: true, message: stdout.trim() || 'Receipt sent.' };
    } catch (error) {
      return {
        success: false,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
