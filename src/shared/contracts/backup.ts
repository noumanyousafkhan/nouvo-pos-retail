import { z } from 'zod';

export const BackupResultSchema = z.object({
  filePath: z.string(),
  sha256: z.string().length(64),
  sizeBytes: z.number().int().nonnegative(),
  schemaVersion: z.number().int().nonnegative(),
  integrity: z.literal('ok'),
});
export const RestoreResultSchema = z.object({
  restoredFrom: z.string(),
  automaticBackupPath: z.string(),
  schemaVersion: z.number().int().nonnegative(),
  integrity: z.literal('ok'),
});
export type BackupResult = z.infer<typeof BackupResultSchema>;
export type RestoreResult = z.infer<typeof RestoreResultSchema>;

export interface BackupApi {
  createBackup(): Promise<BackupResult | null>;
  restoreBackup(): Promise<RestoreResult | null>;
}
