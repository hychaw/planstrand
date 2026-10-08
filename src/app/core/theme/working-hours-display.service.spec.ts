import { TestBed } from '@angular/core/testing';
import { WorkingHoursDisplayService } from './working-hours-display.service';

describe('Planstrand working-hour marker display', () => {
  const restored = { isWorkStartEndEnabled: true, workStart: '09:00', workEnd: '17:00' };
  beforeEach(() => {
    localStorage.removeItem('PLANSTRAND_SHOW_WORKING_HOURS');
  });
  afterEach(() => localStorage.removeItem('PLANSTRAND_SHOW_WORKING_HOURS'));
  it('does not interpret restored inherited defaults as display consent', () => {
    const service = TestBed.inject(WorkingHoursDisplayService);
    expect(service.enabled()).toBeFalse();
    expect(service.hoursFor(restored)).toBeNull();
  });
  it('shows hours only after explicit local opt-in and persists the preference', () => {
    const service = TestBed.inject(WorkingHoursDisplayService);
    service.setEnabled(true);
    expect(service.hoursFor(restored)).toEqual({ workStart: 9, workEnd: 17 });
    expect(localStorage.getItem('PLANSTRAND_SHOW_WORKING_HOURS')).toBe('true');
    service.setEnabled(false);
    expect(service.hoursFor(restored)).toBeNull();
  });
});
