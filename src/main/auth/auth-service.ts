import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify, Algorithm, Version } from '@node-rs/argon2';
import type { DatabaseSync } from 'node:sqlite';
import {
  AuthCredentialsSchema,
  AuthStateSchema,
  CreateUserSchema,
  ResetUserPasswordSchema,
  SetupOwnerSchema,
  UserSummarySchema,
  type AuthState,
  type UserSummary,
} from '../../shared/contracts/auth';
import { runInTransaction } from '../database/connection';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=1$ctaljWPygEo7mx5j+15FzA$F96cFFUdmLkzPKl9ChoymORhTqSHCyb5xXJvcJeI4Lg';
interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: 'owner' | 'manager' | 'cashier' | 'inventory_manager';
  status: 'active' | 'disabled';
  created_at: string;
}
interface ActiveSession {
  sessionId: string;
  userId: string;
  storeId: string;
  counterId: string;
  username: string;
  displayName: string;
  role: UserRow['role'];
  expiresAt: string;
}
let activeSession: ActiveSession | null = null;

function hashOptions() {
  return {
    algorithm: Algorithm.Argon2id,
    version: Version.V0x13,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  };
}
function toUserSummary(user: UserRow): UserSummary {
  return UserSummarySchema.parse({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
  });
}
function permissionsFor(database: DatabaseSync, role: string): string[] {
  return (
    database
      .prepare('SELECT permission FROM role_permissions WHERE role = ? ORDER BY permission')
      .all(role) as { permission: string }[]
  ).map((row) => row.permission);
}
function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function requirePermission(database: DatabaseSync, permission: string): ActiveSession {
  if (!activeSession || Date.parse(activeSession.expiresAt) <= Date.now()) {
    activeSession = null;
    throw new Error('Your session has expired. Sign in again to continue.');
  }
  const current = database
    .prepare(
      'SELECT us.revoked_at, us.expires_at, u.status, u.role FROM user_sessions us JOIN users u ON u.id = us.user_id WHERE us.id = ? AND us.store_id = ? AND us.counter_id = ?',
    )
    .get(activeSession.sessionId, activeSession.storeId, activeSession.counterId) as
    { revoked_at: string | null; expires_at: string; status: string; role: string } | undefined;
  if (
    !current ||
    current.revoked_at ||
    current.status !== 'active' ||
    Date.parse(current.expires_at) <= Date.now()
  ) {
    activeSession = null;
    throw new Error('Your session is no longer valid. Sign in again.');
  }
  if (!permissionsFor(database, current.role).includes(permission))
    throw new Error(`Permission denied: ${permission}. Ask the store owner if you need access.`);
  return activeSession;
}

export class AuthService {
  constructor(
    private readonly database: DatabaseSync,
    private readonly storeId: string,
    private readonly counterId: string,
  ) {}

  getState(): AuthState {
    if (activeSession) {
      try {
        const session = requirePermission(this.database, 'dashboard.view');
        const user = this.database
          .prepare(
            'SELECT id, username, display_name, password_hash, role, status, created_at FROM users WHERE id = ?',
          )
          .get(session.userId) as unknown as UserRow | undefined;
        if (user)
          return AuthStateSchema.parse({
            needsSetup: false,
            authenticated: true,
            user: toUserSummary(user),
            permissions: permissionsFor(this.database, user.role),
          });
      } catch {
        activeSession = null;
      }
    }
    const count = this.database
      .prepare('SELECT COUNT(*) AS count FROM users WHERE store_id = ?')
      .get(this.storeId) as { count: number };
    return AuthStateSchema.parse({
      needsSetup: count.count === 0,
      authenticated: false,
      user: null,
      permissions: [],
    });
  }

  async setupOwner(rawInput: unknown): Promise<AuthState> {
    const input = SetupOwnerSchema.parse(rawInput);
    const count = this.database
      .prepare('SELECT COUNT(*) AS count FROM users WHERE store_id = ?')
      .get(this.storeId) as { count: number };
    if (count.count > 0)
      throw new Error('Initial owner setup has already been completed. Sign in instead.');
    const passwordHash = await hash(input.password, hashOptions());
    const userId = randomUUID();
    runInTransaction(this.database, () => {
      const currentCount = this.database
        .prepare('SELECT COUNT(*) AS count FROM users WHERE store_id = ?')
        .get(this.storeId) as { count: number };
      if (currentCount.count > 0)
        throw new Error('Initial owner setup has already been completed.');
      this.database
        .prepare(
          `INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, 'owner')`,
        )
        .run(userId, this.storeId, input.username, input.displayName, passwordHash);
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'auth.owner_setup', 'user', ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          userId,
          userId,
          JSON.stringify({ username: input.username, role: 'owner' }),
        );
    });
    this.startSession(
      this.database
        .prepare(
          'SELECT id, username, display_name, password_hash, role, status, created_at FROM users WHERE id = ?',
        )
        .get(userId) as unknown as UserRow,
    );
    return this.getState();
  }

  async login(rawInput: unknown): Promise<AuthState> {
    const input = AuthCredentialsSchema.parse(rawInput);
    const cutoff = new Date(Date.now() - LOGIN_LOCK_WINDOW_MS).toISOString();
    const failures = this.database
      .prepare(
        'SELECT COUNT(*) AS count FROM auth_login_attempts WHERE username = ? AND succeeded = 0 AND attempted_at >= ?',
      )
      .get(input.username, cutoff) as { count: number };
    if (failures.count >= MAX_FAILED_LOGINS)
      throw new Error('Too many failed sign-in attempts. Wait 15 minutes before trying again.');
    const user = this.database
      .prepare(
        'SELECT id, username, display_name, password_hash, role, status, created_at FROM users WHERE store_id = ? AND username = ? COLLATE NOCASE',
      )
      .get(this.storeId, input.username) as unknown as UserRow | undefined;
    const validPassword = await verify(
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
      input.password,
    ).catch(() => false);
    const valid = Boolean(user && user.status === 'active' && validPassword);
    this.database
      .prepare('INSERT INTO auth_login_attempts (id, username, succeeded) VALUES (?, ?, ?)')
      .run(randomUUID(), input.username, valid ? 1 : 0);
    if (!valid || !user)
      throw new Error('Invalid username or password, or this account is disabled.');
    this.startSession(user);
    this.database
      .prepare(
        `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'auth.login', 'user', ?, ?)`,
      )
      .run(
        randomUUID(),
        this.storeId,
        user.id,
        user.id,
        JSON.stringify({ username: user.username, role: user.role }),
      );
    return this.getState();
  }

  logout(): void {
    if (activeSession)
      this.database
        .prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), activeSession.sessionId);
    activeSession = null;
  }

  listUsers(): UserSummary[] {
    requirePermission(this.database, 'users.manage');
    const users = this.database
      .prepare(
        'SELECT id, username, display_name, password_hash, role, status, created_at FROM users WHERE store_id = ? ORDER BY created_at',
      )
      .all(this.storeId) as unknown as UserRow[];
    return users.map(toUserSummary);
  }

  async createUser(rawInput: unknown): Promise<UserSummary> {
    const actor = requirePermission(this.database, 'users.manage');
    const input = CreateUserSchema.parse(rawInput);
    const passwordHash = await hash(input.password, hashOptions());
    const id = randomUUID();
    runInTransaction(this.database, () => {
      this.database
        .prepare(
          'INSERT INTO users (id, store_id, username, display_name, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, this.storeId, input.username, input.displayName, passwordHash, input.role);
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'user.created', 'user', ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          actor.userId,
          id,
          JSON.stringify({ username: input.username, role: input.role }),
        );
      this.database
        .prepare(
          `INSERT INTO outbox_events (id, event_type, aggregate_type, aggregate_id, payload_json) VALUES (?, 'user.created', 'user', ?, ?)`,
        )
        .run(
          randomUUID(),
          id,
          JSON.stringify({
            schemaVersion: 1,
            userId: id,
            username: input.username,
            displayName: input.displayName,
            role: input.role,
            status: 'active',
          }),
        );
    });
    return toUserSummary(
      this.database
        .prepare(
          'SELECT id, username, display_name, password_hash, role, status, created_at FROM users WHERE id = ?',
        )
        .get(id) as unknown as UserRow,
    );
  }

  disableUser(userId: string): void {
    const actor = requirePermission(this.database, 'users.manage');
    if (userId === actor.userId)
      throw new Error('You cannot disable the account you are currently using.');
    runInTransaction(this.database, () => {
      const target = this.database
        .prepare('SELECT id, username, role, status FROM users WHERE id = ? AND store_id = ?')
        .get(userId, this.storeId) as
        { id: string; username: string; role: string; status: string } | undefined;
      if (!target) throw new Error('User was not found.');
      if (target.role === 'owner' && target.status === 'active') {
        const owners = this.database
          .prepare(
            "SELECT COUNT(*) AS count FROM users WHERE store_id = ? AND role = 'owner' AND status = 'active'",
          )
          .get(this.storeId) as { count: number };
        if (owners.count <= 1) throw new Error('The last active owner account cannot be disabled.');
      }
      this.database
        .prepare("UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), userId);
      this.database
        .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), userId);
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, 'user.disabled', 'user', ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          actor.userId,
          userId,
          JSON.stringify(target),
          JSON.stringify({ ...target, status: 'disabled' }),
        );
    });
  }

  async resetUserPassword(rawInput: unknown): Promise<void> {
    const actor = requirePermission(this.database, 'users.manage');
    const input = ResetUserPasswordSchema.parse(rawInput);
    const passwordHash = await hash(input.password, hashOptions());
    runInTransaction(this.database, () => {
      const target = this.database
        .prepare('SELECT id, username FROM users WHERE id = ? AND store_id = ?')
        .get(input.userId, this.storeId) as { id: string; username: string } | undefined;
      if (!target) throw new Error('User was not found.');
      this.database
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, new Date().toISOString(), input.userId);
      this.database
        .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(new Date().toISOString(), input.userId);
      this.database
        .prepare(
          `INSERT INTO audit_events (id, store_id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'user.password_reset', 'user', ?, ?)`,
        )
        .run(
          randomUUID(),
          this.storeId,
          actor.userId,
          input.userId,
          JSON.stringify({ username: target.username, resetBy: actor.userId }),
        );
    });
    if (activeSession?.userId === input.userId) activeSession = null;
  }

  private startSession(user: UserRow): void {
    const sessionId = randomUUID();
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS).toISOString();
    this.database
      .prepare(
        'INSERT INTO user_sessions (id, store_id, counter_id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(sessionId, this.storeId, this.counterId, user.id, tokenHash(token), expiresAt);
    activeSession = {
      sessionId,
      userId: user.id,
      storeId: this.storeId,
      counterId: this.counterId,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      expiresAt,
    };
  }
}
