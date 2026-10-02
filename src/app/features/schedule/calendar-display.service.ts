import { computed, inject, Injectable } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { CalendarIntegrationService } from '../calendar-integration/calendar-integration.service';
import { HiddenCalendarProvidersService } from '../calendar-integration/hidden-calendar-providers.service';
import { PluginIssueProviderRegistryService } from '../../plugins/issue-provider/plugin-issue-provider-registry.service';
import { isPluginIssueProvider, IssueProviderKey } from '../issue/issue.model';
import { selectLocalCalendarDisplayItems } from './calendar-display-item.selectors';
import { projectCalendarIntegrationEvent } from './calendar-display-item';
import { CalendarDisplayItem } from './calendar-display-item.model';

/** Shared read facade; ScheduleService consumes its local selector through SVE. */
@Injectable({ providedIn: 'root' })
export class CalendarDisplayService {
  private readonly _localItems = inject(Store).selectSignal(
    selectLocalCalendarDisplayItems,
  );
  private readonly _events = toSignal(
    inject(CalendarIntegrationService).calendarEvents$,
    {
      initialValue: [],
    },
  );
  private readonly _hiddenProviders = inject(HiddenCalendarProvidersService);
  private readonly _registry = inject(PluginIssueProviderRegistryService);

  readonly items = computed<CalendarDisplayItem[]>(() => {
    this._registry.registrationVersion();
    const hidden = new Set(this._hiddenProviders.hiddenProviderIds());
    return [
      ...this._localItems(),
      ...this._events().flatMap((entry) =>
        entry.items
          .filter((event) => !hidden.has(event.calProviderId))
          .map((event) => {
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
  });
}
