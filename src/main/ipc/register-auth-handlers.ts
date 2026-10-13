import { ipcMain } from 'electron';
import {
  AuthCredentialsSchema,
  CreateUserSchema,
  ResetUserPasswordSchema,
  SetupOwnerSchema,
} from '../../shared/contracts/auth';
import { getLocalCounterId, getLocalDatabaseConnection, getLocalStoreId } from '../database';
import { AuthService } from '../auth/auth-service';

const channels = [
  'auth:get-state',
  'auth:setup-owner',
  'auth:login',
  'auth:logout',
  'auth:list-users',
  'auth:create-user',
  'auth:disable-user',
  'auth:reset-user-password',
] as const;
function authService(): AuthService {
  return new AuthService(getLocalDatabaseConnection(), getLocalStoreId(), getLocalCounterId());
}

export function registerAuthIpcHandlers(): void {
  for (const channel of channels) ipcMain.removeHandler(channel);
  ipcMain.handle('auth:get-state', () => authService().getState());
  ipcMain.handle('auth:setup-owner', (_event, rawInput: unknown) =>
    authService().setupOwner(SetupOwnerSchema.parse(rawInput)),
  );
  ipcMain.handle('auth:login', (_event, rawInput: unknown) =>
    authService().login(AuthCredentialsSchema.parse(rawInput)),
  );
  ipcMain.handle('auth:logout', () => authService().logout());
  ipcMain.handle('auth:list-users', () => authService().listUsers());
  ipcMain.handle('auth:create-user', (_event, rawInput: unknown) =>
    authService().createUser(CreateUserSchema.parse(rawInput)),
  );
  ipcMain.handle('auth:disable-user', (_event, rawId: unknown) => {
    if (typeof rawId !== 'string') throw new Error('User ID must be a string.');
    authService().disableUser(rawId);
  });
  ipcMain.handle('auth:reset-user-password', (_event, rawInput: unknown) =>
    authService().resetUserPassword(ResetUserPasswordSchema.parse(rawInput)),
  );
}
