import { ipcMain } from 'electron';
import { ReportQuerySchema } from '../../shared/contracts/reports';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { requirePermission } from '../auth/auth-service';
import { ReportService } from '../reports/report-service';

const channel = 'reports:get-sales-report';
export function registerReportsIpcHandlers(): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, (_event, rawQuery: unknown) => {
    requirePermission(getLocalDatabaseConnection(), 'reports.view');
    const query = ReportQuerySchema.parse(rawQuery ?? {});
    return new ReportService(
      getLocalDatabaseConnection(),
      getLocalStoreId(),
      getLocalCounterId(),
    ).sales(query);
  });
}
