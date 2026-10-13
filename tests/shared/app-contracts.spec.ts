import { describe, expect, it } from 'vitest';
import {
  AppInfoSchema,
  EmptyPayloadSchema,
  RuntimeStatusSchema,
} from '../../src/shared/contracts/app';

describe('shared IPC contracts', () => {
  it('accepts a valid app information response', () => {
    expect(
      AppInfoSchema.parse({
        name: 'NOUVO POS Cash & Carry',
        version: '0.1.0',
        platform: 'linux',
        isPackaged: false,
      }).platform,
    ).toBe('linux');
  });

  it('rejects an unknown platform', () => {
    expect(() =>
      AppInfoSchema.parse({
        name: 'NOUVO POS Cash & Carry',
        version: '0.1.0',
        platform: 'android',
        isPackaged: false,
      }),
    ).toThrow();
  });

  it('rejects unexpected IPC payload fields', () => {
    expect(() => EmptyPayloadSchema.parse({ shellCommand: 'not-allowed' })).toThrow();
  });

  it('does not claim the local database or sync service is ready before implementation', () => {
    expect(
      RuntimeStatusSchema.parse({
        application: 'ready',
        localDatabase: 'not-configured',
        synchronization: 'not-configured',
      }).localDatabase,
    ).toBe('not-configured');
  });
});
