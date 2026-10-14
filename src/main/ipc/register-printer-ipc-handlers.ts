import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ipcMain } from 'electron';
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

async function printWithWindowsRaw(
  lines: string[],
  paperWidthMm: 58 | 80,
): Promise<{ success: boolean; message: string }> {
  const printerQuery = String.raw`$printers = @(Get-CimInstance Win32_Printer | Select-Object Name, DriverName, PortName); $printers | ConvertTo-Json -Compress`;
  let printers: Array<{ Name?: string; DriverName?: string; PortName?: string }>;
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', printerQuery],
      { timeout: 10000, maxBuffer: 8192 },
    );
    const parsed: unknown = JSON.parse(stdout.trim() || '[]');
    printers = (Array.isArray(parsed) ? parsed : [parsed]) as typeof printers;
  } catch (error) {
    return {
      success: false,
      message: `Could not list Windows printers: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`,
    };
  }

  const thermalPrinter = printers.find((printer) =>
    /black\s*copper|rongta|bc[-\s]?88|thermal|receipt|pos[-\s]?(58|80)|xp[-\s]?80|80mm|58mm/i.test(
      [printer.Name, printer.DriverName, printer.PortName].filter(Boolean).join(' '),
    ),
  );
  if (!thermalPrinter?.Name) {
    const installedNames = printers
      .map((printer) => printer.Name)
      .filter(Boolean)
      .join(', ');
    return {
      success: false,
      message: `NOUVO POS could not identify the thermal printer. Installed printers: ${installedNames || 'none found'}. Check the printer name in Windows Settings.`,
    };
  }

  const dir = await mkdtemp(join(tmpdir(), 'nouvo-receipt-'));
  const dataPath = join(dir, 'receipt.bin');
  const scriptPath = join(dir, 'print-raw.ps1');
  const script = String.raw`$ErrorActionPreference = 'Stop'
$printerName = $args[0]
$filePath = $args[1]
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class NouvoRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOC_INFO_1 { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr handle, int level, [In] DOC_INFO_1 info);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
}
'@
$handle = [IntPtr]::Zero
if (-not [NouvoRawPrinter]::OpenPrinter($printerName, [ref]$handle, [IntPtr]::Zero)) { throw "OpenPrinter failed for $printerName (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
try {
  $doc = New-Object 'NouvoRawPrinter+DOC_INFO_1'
  $doc.pDocName = 'NOUVO POS Receipt'
  $doc.pOutputFile = $null
  $doc.pDataType = 'RAW'
  if ([NouvoRawPrinter]::StartDocPrinter($handle, 1, $doc) -eq 0) { throw "StartDocPrinter failed (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
  try {
    if (-not [NouvoRawPrinter]::StartPagePrinter($handle)) { throw "StartPagePrinter failed (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
    try {
      $bytes = [IO.File]::ReadAllBytes($filePath)
      $written = 0
      if (-not [NouvoRawPrinter]::WritePrinter($handle, $bytes, $bytes.Length, [ref]$written)) { throw "WritePrinter failed (Win32 $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
      if ($written -ne $bytes.Length) { throw "Only $written of $($bytes.Length) receipt bytes were queued" }
    } finally { [void][NouvoRawPrinter]::EndPagePrinter($handle) }
  } finally { [void][NouvoRawPrinter]::EndDocPrinter($handle) }
} finally { [void][NouvoRawPrinter]::ClosePrinter($handle) }
Write-Output "RAW receipt data queued to $printerName"
`;
  try {
    await writeFile(dataPath, buildEscPos(lines, paperWidthMm), { mode: 0o600 });
    await writeFile(scriptPath, script, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath,
        thermalPrinter.Name,
        dataPath,
      ],
      { timeout: 15000, maxBuffer: 4096 },
    );
    return {
      success: true,
      message: stdout.trim() || `Receipt data sent to ${thermalPrinter.Name}.`,
    };
  } catch (error) {
    return {
      success: false,
      message: `RAW printing to ${thermalPrinter.Name} failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 400)}. Confirm the Windows driver supports ESC/POS RAW printing.`,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function registerPrinterIpcHandlers(): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (_event, raw: unknown) => {
    const input = ThermalReceiptSchema.parse(raw);

    if (process.platform === 'win32') {
      return printWithWindowsRaw(input.lines, input.paperWidthMm);
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
