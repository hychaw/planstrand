import { TestBed } from '@angular/core/testing';
import { DensityService } from './density.service';

describe('DensityService', () => {
  beforeEach(() => {
    localStorage.removeItem('PLANSTRAND_DENSITY');
    delete document.body.dataset['density'];
  });

  afterEach(() => {
    localStorage.removeItem('PLANSTRAND_DENSITY');
    delete document.body.dataset['density'];
  });

  it('uses Comfortable for absent or invalid stored preferences', () => {
    localStorage.setItem('PLANSTRAND_DENSITY', 'invalid');
    const service = TestBed.inject(DensityService);
    expect(service.density()).toBe('comfortable');
    expect(document.body.dataset['density']).toBe('comfortable');
  });

  it('restores Compact on startup', () => {
    localStorage.setItem('PLANSTRAND_DENSITY', 'compact');
    expect(TestBed.inject(DensityService).density()).toBe('compact');
    expect(document.body.dataset['density']).toBe('compact');
  });

  it('updates the display and persists the device preference', () => {
    const service = TestBed.inject(DensityService);
    service.setDensity('compact');
    expect(document.body.dataset['density']).toBe('compact');
    expect(localStorage.getItem('PLANSTRAND_DENSITY')).toBe('compact');
    service.setDensity('comfortable');
    expect(service.density()).toBe('comfortable');
    expect(localStorage.getItem('PLANSTRAND_DENSITY')).toBe('comfortable');
  });

  it('remains usable when device storage is unavailable', () => {
    spyOn(Storage.prototype, 'getItem').and.throwError('Storage unavailable');
    spyOn(Storage.prototype, 'setItem').and.throwError('Storage unavailable');
    const service = TestBed.inject(DensityService);
    expect(() => service.setDensity('compact')).not.toThrow();
    expect(service.density()).toBe('compact');
    expect(document.body.dataset['density']).toBe('compact');
  });
});
