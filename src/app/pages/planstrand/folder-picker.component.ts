import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { FolderTreeRow } from '../../features/folder/folder-tree';

@Component({
  selector: 'planstrand-folder-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogActions, MatDialogContent, MatButton, FormsModule, TranslatePipe],
  template: `
    <mat-dialog-content>
      <label
        >{{ data.label | translate }}
        <select [(ngModel)]="selected">
          @if (data.allowRoot) {
            <option value="">{{ 'PLANSTRAND.ROOT' | translate }}</option>
          }
          @for (row of data.rows; track row.folder.id) {
            <option [value]="row.folder.id">{{ row.path }}</option>
          }
        </select>
      </label>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        (click)="dialog.close()"
      >
        {{ 'G.CANCEL' | translate }}
      </button>
      <button
        mat-flat-button
        color="primary"
        (click)="dialog.close(selected)"
      >
        {{ 'G.SAVE' | translate }}
      </button>
    </mat-dialog-actions>
  `,
})
export class FolderPickerComponent {
  readonly data = inject<{
    rows: FolderTreeRow[];
    current: string;
    allowRoot: boolean;
    label: string;
  }>(MAT_DIALOG_DATA);
  readonly dialog = inject<MatDialogRef<FolderPickerComponent, string>>(MatDialogRef);
  selected = this.data.current;
}
