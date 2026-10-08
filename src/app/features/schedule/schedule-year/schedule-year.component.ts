import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { TranslatePipe } from '@ngx-translate/core';
import { CalendarDisplayService } from '../calendar-display.service';
import { calendarDate } from '../calendar-time';
import { getDbDateStr } from '../../../util/get-db-date-str';

/** Navigation and awareness only: the shared projection remains authoritative. */
@Component({
  selector: 'schedule-year',
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="year-grid">
      @for (month of months(); track month.index) {
        <section>
          <button
            class="month-title"
            (click)="monthSelected.emit(month.date)"
          >
            {{ month.label }}
          </button>
          <div class="mini-month">
            @for (weekday of weekdays(); track $index) {
              <span class="weekday">{{ weekday }}</span>
            }
            @for (empty of month.padding; track $index) {
              <span aria-hidden="true"></span>
            }
            @for (day of month.days; track day.key) {
              <button
                class="day"
                [class.today]="day.key === today()"
                [attr.aria-current]="day.key === today() ? 'date' : null"
                [attr.aria-label]="
                  day.label +
                  (day.count
                    ? ', ' +
                      ('PLANSTRAND.CALENDAR_ITEMS' | translate: { count: day.count })
                    : '')
                "
                [title]="day.label"
                (click)="dateSelected.emit(day.date)"
              >
                {{ day.number }}
                <span
                  class="activity"
                  [class.has-work]="day.hasWork"
                  [class.has-items]="day.count > 0"
                  aria-hidden="true"
                ></span>
              </button>
            }
          </div>
        </section>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: var(--planstrand-page-padding);
      font-variant-numeric: tabular-nums;
    }
    .year-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 32px 40px;
      max-width: 1300px;
      margin-inline: auto;
    }
    section {
      min-width: 0;
    }
    button {
      font: inherit;
      color: var(--ink);
      background: transparent;
      border: 0;
      cursor: pointer;
      border-radius: var(--radius-sm);
    }
    button:hover {
      background: var(--surface-hover);
      color: var(--brand);
    }
    .month-title {
      font-size: var(--font-size-lg);
      font-weight: 600;
      margin-bottom: 12px;
      padding: 8px;
      color: var(--ink-strong);
    }
    .mini-month {
      display: grid;
      grid-template-columns: repeat(7, minmax(0, 1fr));
      gap: 3px;
      text-align: center;
    }
    .weekday {
      color: var(--ink-muted);
      font-size: var(--font-size-xs);
      padding-block: 6px;
    }
    .day {
      position: relative;
      min-height: 36px;
      padding: 7px 2px 11px;
    }
    .day.today {
      background: var(--planstrand-cobalt);
      color: white;
      font-weight: 600;
    }
    .activity {
      position: absolute;
      bottom: 4px;
      left: calc(50% - 2px);
      width: 4px;
      height: 4px;
      border-radius: 50%;
    }
    .has-items {
      background: currentColor;
      opacity: 0.65;
    }
    .has-work {
      width: 8px;
      left: calc(50% - 4px);
      border-radius: 2px;
      color: var(--brand);
      opacity: 1;
    }
    .today .activity {
      color: white;
    }
    @media (max-width: 1100px) {
      .year-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
      }
    }
    @media (max-width: 620px) {
      .year-grid {
        grid-template-columns: minmax(0, 1fr);
        gap: 28px;
      }
      .day {
        min-height: 44px;
      }
    }
  `,
})
export class ScheduleYearComponent {
  readonly year = input.required<number>();
  readonly firstDayOfWeek = input(1);
  readonly today = input('');
  readonly monthSelected = output<Date>();
  readonly dateSelected = output<Date>();
  private readonly calendar = inject(CalendarDisplayService);
  private readonly dateTimeFormat = inject(DateTimeFormatService);
  readonly weekdays = computed(() =>
    Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(this.dateTimeFormat.textLocale(), {
        weekday: 'short',
      }).format(new Date(2024, 0, 7 + ((this.firstDayOfWeek() + i) % 7))),
    ),
  );
  readonly months = computed(() => {
    const locale = this.dateTimeFormat.textLocale();
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long' });
    const dayFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'full' });
    const items = this.calendar.items();
    const zone = this.calendar.displayTimeZone();
    const projected = items.map((item) => ({
      start: item.date ?? calendarDate(item.start, zone),
      end:
        item.isAllDay && item.date
          ? item.date
          : calendarDate(Math.max(item.start, item.end - 1), zone),
      hasWork: item.sourceType === 'workSession',
    }));
    return Array.from({ length: 12 }, (_month, index) => {
      const date = new Date(this.year(), index, 1, 12);
      const count = new Date(this.year(), index + 1, 0).getDate();
      return {
        index,
        date,
        label: monthFormatter.format(date),
        padding: Array.from({ length: (date.getDay() - this.firstDayOfWeek() + 7) % 7 }),
        days: Array.from({ length: count }, (_day, i) => {
          const dayDate = new Date(this.year(), index, i + 1, 12);
          const key = getDbDateStr(dayDate);
          const matches = projected.filter(
            (item) => item.start <= key && item.end >= key,
          );
          return {
            date: dayDate,
            label: dayFormatter.format(dayDate),
            key,
            number: i + 1,
            count: matches.length,
            hasWork: matches.some((item) => item.hasWork),
          };
        }),
      };
    });
  });
}
