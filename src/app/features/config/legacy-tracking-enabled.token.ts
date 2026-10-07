import { InjectionToken } from '@angular/core';

/** Compatibility implementation can be tested independently of the Planstrand host. */
export const LEGACY_TRACKING_ENABLED = new InjectionToken<boolean>(
  'LEGACY_TRACKING_ENABLED',
  { providedIn: 'root', factory: () => false },
);
