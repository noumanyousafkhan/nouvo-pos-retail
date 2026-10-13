import { ipcMain } from 'electron';
import { CheckoutInputSchema } from '../../shared/contracts/checkout';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { CheckoutService } from '../checkout/checkout-service';
import { requirePermission } from '../auth/auth-service';

const completeSaleChannel = 'checkout:complete-sale';

export function registerCheckoutIpcHandlers(): void {
  ipcMain.removeHandler(completeSaleChannel);
  ipcMain.handle(completeSaleChannel, (_event, rawInput: unknown) => {
    const database = getLocalDatabaseConnection();
    requirePermission(database, 'checkout.use');
    if (
      !database
        .prepare("SELECT 1 FROM cashier_sessions WHERE counter_id = ? AND status = 'open'")
        .get(getLocalCounterId())
    )
      throw new Error(
        'Open a cashier shift before completing a sale. Go to Cashier shifts to open one.',
      );
    const input = CheckoutInputSchema.parse(rawInput);
    return new CheckoutService(database, getLocalStoreId(), getLocalCounterId()).complete(input);
  });
}
