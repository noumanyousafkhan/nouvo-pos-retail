import { z } from 'zod';

export const BusinessSettingsSchema = z.object({
  storeId: z.string().uuid(),
  name: z.string().trim().min(1).max(160),
  currencyCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  timezone: z.string().trim().min(1).max(100),
  taxBehavior: z.enum(['exclusive', 'inclusive']),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(80),
  businessRegistrationNumber: z.string().trim().max(100),
  receiptFooter: z.string().trim().max(500),
  receiptPaperWidthMm: z.union([z.literal(58), z.literal(80)]),
});
export const SaveBusinessSettingsSchema = BusinessSettingsSchema.omit({ storeId: true });
export type BusinessSettings = z.infer<typeof BusinessSettingsSchema>;
export type SaveBusinessSettings = z.infer<typeof SaveBusinessSettingsSchema>;

export interface SettingsApi {
  getBusinessSettings(): Promise<BusinessSettings>;
  saveBusinessSettings(input: SaveBusinessSettings): Promise<BusinessSettings>;
}
