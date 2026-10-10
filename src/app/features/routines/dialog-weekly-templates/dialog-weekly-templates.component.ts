import {
  afterNextRender,
  Injector,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { A11yModule } from '@angular/cdk/a11y';
import { FormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import { T } from '../../../t.const';
import { DateService } from '../../../core/date/date.service';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { DialogEventComponent } from '../../event/dialog-event/dialog-event.component';
import { WeeklyTemplateService } from '../weekly-template.service';
import { WeeklyTemplate } from '../weekly-template.model';
import { isValidWeeklyTemplateInput } from '../weekly-template.validation';
import { EventSeriesService } from '../event-series.service';
import { EventSeries } from '../event-series.model';

@Component({
  selector: 'dialog-weekly-templates',
  imports: [A11yModule, FormsModule, MatDialogModule, MatButtonModule, TranslatePipe],
  templateUrl: './dialog-weekly-templates.component.html',
  styleUrl: './dialog-weekly-templates.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DialogWeeklyTemplatesComponent {
  readonly T = T;
  readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  readonly newButton = viewChild('newButton', { read: ElementRef<HTMLButtonElement> });
  constructor() {
    effect(() => this.titleInput()?.nativeElement.focus());
  }
  private readonly _injector = inject(Injector);
  readonly addButton = viewChild('addButton', { read: ElementRef<HTMLButtonElement> });
  private _focusNew(): void {
    afterNextRender(() => this.newButton()?.nativeElement.focus(), {
      injector: this._injector,
    });
  }
  cancelEdit(): void {
    this.editing.set(false);
    this._focusNew();
  }
  private readonly _templates = inject(WeeklyTemplateService);
  private readonly _series = inject(EventSeriesService);
  private readonly _dialog = inject(MatDialog);
  private readonly _dates = inject(DateService);
  readonly templates = computed(() =>
    Object.values(this._templates.entities())
      .filter((t): t is WeeklyTemplate => !!t && t.deletedAt === undefined)
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
  );
  readonly selectedId = signal<string | null>(null);
  readonly selected = computed(() =>
    this.templates().find((t) => t.id === this.selectedId()),
  );
  readonly entries = computed(() => this.entriesFor(this.selectedId()));
  readonly editing = signal(false);
  readonly busy = signal(false);
  readonly invalid = signal(false);
  title = '';
  startDate = this._dates.todayStr();
  endDate = '';
  entriesFor(id: string | null): EventSeries[] {
    return Object.values(this._series.entities())
      .filter(
        (s): s is EventSeries => !!s && s.templateId === id && s.deletedAt === undefined,
      )
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  }
  select(id: string): void {
    this.selectedId.set(id);
    this.editing.set(false);
    this.invalid.set(false);
  }
  edit(template?: WeeklyTemplate): void {
    this.selectedId.set(template?.id ?? null);
    this.title = template?.title ?? '';
    this.startDate = template?.startDate ?? this._dates.todayStr();
    this.endDate = template?.endDate ?? '';
    this.invalid.set(false);
    this.editing.set(true);
  }
  save(): void {
    if (this.busy() || !this.editing()) return;
    const current = this.selected();
    const input = {
      title: this.title.trim(),
      startDate: this.startDate,
      ...(this.endDate ? { endDate: this.endDate } : {}),
      isActive: current?.isActive ?? false,
    };
    if (!isValidWeeklyTemplateInput(input)) {
      this.invalid.set(true);
      return;
    }
    this.busy.set(true);
    try {
      if (current) {
        if (
          !this._templates.updateDateWindow(current.id, input.startDate, input.endDate) ||
          !this._templates.rename(current.id, input.title)
        ) {
          this.invalid.set(true);
          return;
        }
      } else {
        const id = this._templates.create(input);
        if (!id) {
          this.invalid.set(true);
          return;
        }
        this.selectedId.set(id);
      }
      this.editing.set(false);
      this.invalid.set(false);
      this._focusNew();
    } finally {
      this.busy.set(false);
    }
  }
  toggle(template: WeeklyTemplate): void {
    if (!this.busy()) this._templates.setActive(template.id, !template.isActive);
  }
  openEntry(seriesId?: string): void {
    const template = this.selected();
    if (!template || this.busy()) return;
    const ref = this._dialog.open(DialogEventComponent, {
      data: seriesId
        ? { seriesId }
        : { templateId: template.id, date: template.startDate },
      width: '560px',
      maxWidth: '95vw',
      restoreFocus: true,
    });
    ref.afterClosed().subscribe(() => {
      if (seriesId && this._series.entities()[seriesId]?.deletedAt !== undefined)
        afterNextRender(() => this.addButton()?.nativeElement.focus(), {
          injector: this._injector,
        });
    });
  }
  async remove(): Promise<void> {
    const template = this.selected();
    if (!template || this.busy()) return;
    this.busy.set(true);
    try {
      const confirmed = await firstValueFrom(
        this._dialog
          .open(DialogConfirmComponent, {
            data: {
              message: 'F.WEEKLY_TEMPLATE.DELETE_CONFIRM',
              cancelTxt: T.G.CANCEL,
              okTxt: T.G.DELETE,
            },
          })
          .afterClosed(),
      );
      if (confirmed && this._templates.delete(template.id)) {
        this._focusNew();
        this.selectedId.set(null);
        this.editing.set(false);
      }
    } finally {
      this.busy.set(false);
    }
  }
  readonly weekdays = [
    T.F.EVENT.MONDAY,
    T.F.EVENT.TUESDAY,
    T.F.EVENT.WEDNESDAY,
    T.F.EVENT.THURSDAY,
    T.F.EVENT.FRIDAY,
    T.F.EVENT.SATURDAY,
    T.F.EVENT.SUNDAY,
  ];
}
