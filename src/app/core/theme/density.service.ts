import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

export type Density = 'comfortable' | 'compact';
const DENSITY_KEY = 'PLANSTRAND_DENSITY';

/** Device-local presentation preference; deliberately outside NgRx and sync. */
@Injectable({ providedIn: 'root' })
export class DensityService {
  private readonly _document = inject(DOCUMENT);
  private readonly _density = signal<Density>('comfortable');
  readonly density = this._density.asReadonly();

  constructor() {
    let stored: string | null = null;
    try {
      stored = this._document.defaultView?.localStorage.getItem(DENSITY_KEY) ?? null;
    } catch {
      // Restricted storage must not prevent local planning.
    }
    this._apply(stored === 'compact' ? 'compact' : 'comfortable');
  }

  setDensity(density: Density): void {
    this._apply(density);
    try {
      this._document.defaultView?.localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // Keep the preference for this session when storage is unavailable.
    }
  }

  private _apply(density: Density): void {
    this._density.set(density);
    this._document.body.dataset['density'] = density;
  }
}
