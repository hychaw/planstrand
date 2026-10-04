import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { PlanstrandService } from './planstrand.service';

@Component({
  selector: 'planstrand-folder-navigation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TranslatePipe, MatButton],
  template: `
    <button
      mat-button
      (click)="ui.createFolder()"
    >
      {{ 'PLANSTRAND.CREATE_FOLDER' | translate }}
    </button>
    @for (row of ui.visibleRows(); track row.folder.id) {
      <div
        class="folder-link"
        [style.padding-inline-start]="'calc(var(--s) * ' + row.depth + ')'"
      >
        <button
          type="button"
          (click)="ui.toggle(row.folder.id)"
          [attr.aria-expanded]="!ui.collapsed().has(row.folder.id)"
          [attr.aria-label]="
            ('PLANSTRAND.TOGGLE_FOLDER' | translate) + ': ' + row.folder.title
          "
        >
          {{ row.hasChildren ? (ui.collapsed().has(row.folder.id) ? '▸' : '▾') : '·' }}
        </button>
        <a
          [routerLink]="['/folder', row.folder.id]"
          [title]="row.path"
          (click)="navigated.emit()"
          >{{ row.folder.title }}</a
        >
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      padding: var(--s);
    }
    .folder-link {
      display: flex;
      align-items: center;
      gap: var(--s-half);
      min-height: var(--s4);
    }
    a {
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `,
})
export class FolderNavigationComponent {
  readonly ui = inject(PlanstrandService);
  readonly navigated = output<void>();
}
