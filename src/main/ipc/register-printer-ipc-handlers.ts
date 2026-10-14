import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ipcMain } from 'electron';
import { ThermalReceiptSchema } from '../../shared/contracts/app';

const execFileAsync = promisify(execFile);
const channel = 'printer:print-thermal-receipt';
const queue = '80Series2';

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
export function registerPrinterIpcHandlers(): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const input = ThermalReceiptSchema.parse(raw);
    if (process.platform !== 'linux')
      return { success: false, message: 'Direct printer output is available on Linux only.' };
    const dir = await mkdtemp(join(tmpdir(), 'nouvo-receipt-'));
    const file = join(dir, 'receipt.bin');
    try {
      await writeFile(file, buildEscPos(input.lines, input.paperWidthMm), { mode: 0o600 });
      const { stdout } = await execFileAsync('lp', ['-d', queue, '-o', 'raw', file], {
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
