import type { NouvoApi } from '../../../shared/contracts/app';

declare global {
  interface Window {
    readonly nouvo: NouvoApi;
  }
}

export {};
