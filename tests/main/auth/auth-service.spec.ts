// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService, requirePermission } from '../../../src/main/auth/auth-service';
import { openLocalDatabase, type LocalDatabase } from '../../../src/main/database/connection';

const opened: Array<{ database: LocalDatabase; auth: AuthService }> = [];
function setup() {
  const database = openLocalDatabase(':memory:');
  const storeId = randomUUID();
  const counterId = randomUUID();
  database.connection
    .prepare('INSERT INTO stores (id, name) VALUES (?, ?)')
    .run(storeId, 'Test Store');
  database.connection
    .prepare('INSERT INTO counters (id, store_id, name) VALUES (?, ?, ?)')
    .run(counterId, storeId, 'Counter 1');
  const auth = new AuthService(database.connection, storeId, counterId);
  opened.push({ database, auth });
  return { database, auth };
}

afterEach(() => {
  for (const { database, auth } of opened.splice(0)) {
    try {
      auth.logout();
    } catch {
      /* A failed setup may not have an active session. */
    }
    database.close();
  }
});

describe('authentication and role permissions', () => {
  it('requires one-time owner setup and creates a valid authenticated owner session', async () => {
    const { auth } = setup();
    expect(auth.getState()).toMatchObject({ needsSetup: true, authenticated: false });
    const state = await auth.setupOwner({
      username: 'owner.one',
      displayName: 'Store Owner',
      password: 'A-Strong-Password-42!',
    });
    expect(state).toMatchObject({
      needsSetup: false,
      authenticated: true,
      user: { username: 'owner.one', role: 'owner' },
    });
    expect(state.permissions).toContain('users.manage');
    await expect(
      auth.setupOwner({
        username: 'owner.two',
        displayName: 'Second Owner',
        password: 'Another-Strong-Password-42!',
      }),
    ).rejects.toThrow(/already been completed/i);
  });

  it('rejects invalid credentials and permits a valid login', async () => {
    const { auth } = setup();
    await auth.setupOwner({
      username: 'owner.one',
      displayName: 'Store Owner',
      password: 'A-Strong-Password-42!',
    });
    auth.logout();
    await expect(auth.login({ username: 'owner.one', password: 'wrong-password' })).rejects.toThrow(
      /invalid username or password/i,
    );
    const state = await auth.login({ username: 'OWNER.ONE', password: 'A-Strong-Password-42!' });
    expect(state.authenticated).toBe(true);
    expect(state.user?.role).toBe('owner');
  });

  it('enforces permissions in the main process, not just in navigation', async () => {
    const { database, auth } = setup();
    await auth.setupOwner({
      username: 'owner.one',
      displayName: 'Store Owner',
      password: 'A-Strong-Password-42!',
    });
    await auth.createUser({
      username: 'cashier.one',
      displayName: 'Cashier One',
      password: 'Cashier-Strong-Password-42!',
      role: 'cashier',
    });
    auth.logout();
    await auth.login({ username: 'cashier.one', password: 'Cashier-Strong-Password-42!' });
    expect(requirePermission(database.connection, 'checkout.use').role).toBe('cashier');
    expect(() => requirePermission(database.connection, 'users.manage')).toThrow(
      /permission denied/i,
    );
  });
});
