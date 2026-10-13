import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import pino from 'pino';

const logDirectory = app.getPath('logs');
mkdirSync(logDirectory, { recursive: true });

const destination = pino.destination({
  dest: join(logDirectory, 'nouvo-pos.log'),
  sync: false,
});

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['password', '*.password', 'token', '*.token', 'authorization', '*.authorization'],
      censor: '[REDACTED]',
    },
    base: { application: 'NOUVO POS Cash & Carry' },
  },
  destination,
);
