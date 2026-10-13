import { ipcMain } from 'electron';
import { CheckoutInputSchema } from '../../shared/contracts/checkout';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { CheckoutService } from '../checkout/checkout-service';

const completeSaleChannel = 'checkout:complete-sale';

export function registerCheckoutIpcHandlers(): void {
  ipcMain.removeHandler(completeSaleChannel);
  ipcMain.handle(completeSaleChannel, (_event, rawInput: unknown) => {
    const input = CheckoutInputSchema.parse(rawInput);
    return new CheckoutService(
      getLocalDatabaseConnection(),
      getLocalStoreId(),
      getLocalCounterId(),
    ).complete(input);
  });
}
