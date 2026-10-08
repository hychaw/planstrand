import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { INBOX_FOLDER_ID } from '../../features/folder/folder.const';
import { RouterLinkActive, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MatButton } from '@angular/material/button';
import { PlanstrandService } from './planstrand.service';

@Component({
  selector: 'planstrand-folder-navigation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterLinkActive, TranslatePipe, MatButton],
  template: `
    <div class="folder-section-heading">
      <span>{{ 'PLANSTRAND.FOLDERS' | translate }}</span>
      <button
        mat-button
        (click)="ui.createFolder()"
        [attr.aria-label]="'PLANSTRAND.CREATE_FOLDER' | translate"
      >
        +
      </button>
    </div>
    @for (row of ui.visibleRows(); track row.folder.id) {
      <div
        class="folder-link"
        [style.padding-inline-start]="'calc(var(--s) * ' + row.depth + ')'"
      >
        <button
          type="button"
          (click)="ui.toggle(row.folder.id)"
          [disabled]="!row.hasChildren"
          [attr.aria-expanded]="!ui.collapsed().has(row.folder.id)"
          [attr.aria-label]="
            ('PLANSTRAND.TOGGLE_FOLDER' | translate) + ': ' + row.folder.title
          "
        >
          {{ row.hasChildren ? (ui.collapsed().has(row.folder.id) ? '▸' : '▾') : '' }}
        </button>
        <a
          [routerLink]="
            row.folder.id === inboxId ? ['/inbox'] : ['/folder', row.folder.id]
          "
          routerLinkActive="active"
          [title]="row.path"
          (click)="navigated.emit()"
          ><svg
            class="folder-symbol"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            aria-hidden="true"
          >
            <path
              [attr.d]="
                row.folder.id === inboxId
                  ? 'M4 5h16l2 10v5H2v-5L4 5ZM2 15h6l2 3h4l2-3h6'
                  : 'M3 5h7l2 3h9v12H3V5Z'
              "
            /></svg
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
    .folder-section-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: var(--ink-muted);
      font-size: var(--font-size-xs);
      letter-spacing: 0.04em;
      padding-inline: 12px;
      margin-block: 12px 8px;
    }
    .folder-section-heading button {
      min-width: 32px;
      font-size: 22px;
    }
    .folder-symbol {
      margin-inline-end: 10px;
      vertical-align: middle;
      color: var(--brand);
    }
    a.active {
      color: var(--brand);
      font-weight: 600;
    }
    .folder-link {
      display: flex;
      align-items: center;
      gap: var(--s-half);
      min-height: var(--planstrand-row-height);
      border-radius: var(--radius-sm);
    }
    .folder-link:hover,
    .folder-link:focus-within {
      background: var(--sidenav-hover-bg);
    }
    .folder-link button {
      font: inherit;
      color: var(--ink-muted);
      border: 0;
      background: transparent;
      cursor: pointer;
      min-height: 32px;
      min-width: 28px;
    }
    a {
      color: var(--text-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-decoration: none;
      font-size: var(--font-size-sm);
      color: var(--ink-muted);
    }
  `,
})
export class FolderNavigationComponent {
  readonly inboxId = INBOX_FOLDER_ID;
  readonly ui = inject(PlanstrandService);
  readonly navigated = output<void>();
}
