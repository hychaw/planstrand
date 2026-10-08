import { CurrentDateService } from '../../core/date/current-date.service';
import { selectLocalizationConfig } from '../config/store/global-config.reducer';
import { calendarDisplayZone } from './calendar-time';
import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { isPluginIssueProvider, IssueProviderKey } from '../issue/issue.model';
import { selectPersistedCalendarDisplayItems } from './calendar-display-item.selectors';
import { projectCalendarIntegrationEvent } from './calendar-display-item';
import { CalendarDisplayItem } from './calendar-display-item.model';

/** Canonical calendar facade: WorkSessions, Events, legacy fallback and provider adapters. */
@Injectable({ providedIn: 'root' })
export class CalendarDisplayService {
  private readonly _localization = inject(Store).selectSignal(selectLocalizationConfig);
  private readonly _dates = inject(CurrentDateService);
  readonly displayTimeZone = computed(() => {
    this._dates.now();
    return calendarDisplayZone(this._localization()?.timeZone);
  });
  readonly today = this._dates.dateInZone(this.displayTimeZone);

  private readonly _localItems = inject(Store).selectSignal(
    selectPersistedCalendarDisplayItems,
  );
  private readonly _events = toSignal(
    inject(CalendarIntegrationService).calendarEvents$,
    {
      initialValue: [],
    },
  );
  private readonly _hiddenProviders = inject(HiddenCalendarProvidersService);
  private readonly _registry = inject(PluginIssueProviderRegistryService);

  /** Existing provider buckets, filtered once for the unified calendar and SVE adapter. */
  readonly externalCalendars = computed(() => {
    const hidden = new Set(this._hiddenProviders.hiddenProviderIds());
    const seen = new Set<string>();
    return this._events()
      .map((entry) => ({
        ...entry,
        items: entry.items.filter((event) => {
          const key = JSON.stringify([event.calProviderId, event.id]);
          if (hidden.has(event.calProviderId) || seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      }))
      .filter((entry) => entry.items.length > 0);
  });

  readonly items = computed<CalendarDisplayItem[]>(() => {
    this._registry.registrationVersion();
    const items = [
      ...this._localItems(),
      ...this.externalCalendars().flatMap((entry) =>
        entry.items.map((event) => {
          const definition = isPluginIssueProvider(
            event.issueProviderKey as IssueProviderKey,
          )
            ? this._registry.getProvider(event.issueProviderKey)?.definition
            : undefined;
          return projectCalendarIntegrationEvent(
            event,
            !!definition?.updateIssue,
            !!definition?.deleteIssue,
          );
        }),
      ),
    ];
    return [...new Map(items.map((item) => [item.id, item])).values()];
  });
}
