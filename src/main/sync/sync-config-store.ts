import { safeStorage } from 'electron';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const StoredSyncConfigSchema = z
  .object({
    url: z.string().url(),
    encryptedToken: z.string().min(1),
  })
  .strict();

export interface SyncCredentials {
  url: string;
  token: string;
}

export interface PublicSyncConfig {
  url: string;
  configured: boolean;
  secureStorageAvailable: boolean;
}

export function normalizeSyncUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localHost))
    throw new Error('Sync server URL must use HTTPS. HTTP is allowed only for localhost testing.');
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      'Sync server URL must not contain credentials, query parameters or a fragment.',
    );
  return url.origin;
}

export class SyncConfigStore {
  constructor(private readonly filePath: string) {}

  get secureStorageAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }

  async load(): Promise<SyncCredentials | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if (!this.secureStorageAvailable)
      throw new Error(
        'OS secure storage is unavailable; saved sync credentials were not decrypted.',
      );
    let json: unknown;
    try {
      json = JSON.parse(raw) as unknown;
    } catch {
      throw new Error('Saved sync configuration is invalid JSON.');
    }
    const parsed = StoredSyncConfigSchema.safeParse(json);
    if (!parsed.success) throw new Error('Saved sync configuration has an invalid shape.');
    const url = normalizeSyncUrl(parsed.data.url);
    let token: string;
    try {
      token = safeStorage.decryptString(Buffer.from(parsed.data.encryptedToken, 'base64'));
    } catch {
      throw new Error('Saved sync token could not be decrypted by this operating-system account.');
    }
    if (token.trim().length < 32) throw new Error('Saved sync token is invalid or too short.');
    return { url, token };
  }

  async save(urlInput: string, tokenInput: string): Promise<SyncCredentials> {
    if (!this.secureStorageAvailable)
      throw new Error(
        'OS secure storage is unavailable. Configure sync using environment variables instead.',
      );
    const url = normalizeSyncUrl(urlInput);
    const existing = await this.load();
    const token = tokenInput.trim() || existing?.token || '';
    if (token.length < 32)
      throw new Error(
        'Enter a counter token of at least 32 characters the first time you configure sync.',
      );
    const encryptedToken = safeStorage.encryptString(token).toString('base64');
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await writeFile(this.filePath, JSON.stringify({ url, encryptedToken }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await chmod(this.filePath, 0o600);
    return { url, token };
  }
}
