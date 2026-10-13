import { z } from 'zod';

export const UserRoleSchema = z.enum(['owner', 'manager', 'cashier', 'inventory_manager']);
export const AuthCredentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(1).max(128),
});
export const SetupOwnerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
});
export const CreateUserSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/),
  displayName: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
  role: UserRoleSchema,
});
export const ResetUserPasswordSchema = z.object({
  userId: z.string().uuid(),
  password: z.string().min(12).max(128),
});
export const UserSummarySchema = z.object({
  id: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  role: UserRoleSchema,
  status: z.enum(['active', 'disabled']),
  createdAt: z.string(),
});
export const AuthStateSchema = z.object({
  needsSetup: z.boolean(),
  authenticated: z.boolean(),
  user: UserSummarySchema.nullable(),
  permissions: z.array(z.string()),
});
export type AuthCredentials = z.infer<typeof AuthCredentialsSchema>;
export type SetupOwnerInput = z.infer<typeof SetupOwnerSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type ResetUserPasswordInput = z.infer<typeof ResetUserPasswordSchema>;
export type UserSummary = z.infer<typeof UserSummarySchema>;
export type AuthState = z.infer<typeof AuthStateSchema>;

export interface AuthApi {
  getAuthState(): Promise<AuthState>;
  setupOwner(input: SetupOwnerInput): Promise<AuthState>;
  login(input: AuthCredentials): Promise<AuthState>;
  logout(): Promise<void>;
  listUsers(): Promise<UserSummary[]>;
  createUser(input: CreateUserInput): Promise<UserSummary>;
  disableUser(id: string): Promise<void>;
  resetUserPassword(input: ResetUserPasswordInput): Promise<void>;
}
