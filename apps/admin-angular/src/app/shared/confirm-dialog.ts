import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';

export interface ConfirmData { title: string; message: string; confirm: string; danger?: boolean }

/** Confirmation Material (remplace window.confirm) : titre, message clair, action explicite. */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Le bouton plein de marque est posé avec !important dans styles.scss : le sélecteur doit être plus spécifique, même au survol.
  styles: `p { margin: 0; color: var(--text-2); max-width: 46ch; } button.mat-mdc-unelevated-button.danger:not(:disabled) { background: var(--danger) !important; color: #2a0710 !important; box-shadow: none !important; }`,
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content><p>{{ data.message }}</p></mat-dialog-content>
    <mat-dialog-actions align="end">
      <!-- Action irréversible : le focus arrive sur « Annuler », pour qu'un Entrée de trop ne supprime rien. -->
      <button matButton mat-dialog-close [attr.cdkFocusInitial]="data.danger ? '' : null">Annuler</button>
      <button matButton="filled" [class.danger]="data.danger" [mat-dialog-close]="true" [attr.cdkFocusInitial]="data.danger ? null : ''">{{ data.confirm }}</button>
    </mat-dialog-actions>
  `,
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmData>(MAT_DIALOG_DATA);
}
