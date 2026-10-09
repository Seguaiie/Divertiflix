import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import type { AdminRequest, AdminTitle } from '../../core/models';

export interface RequestActionData { request: AdminRequest; action: 'Available' | 'Declined' }
export interface RequestActionResult { titleId?: string; reason?: string }

/**
 * Deux décisions demandent une précision : marquer « disponible » exige le titre du catalogue qui satisfait la demande
 * (l'API refuse un titre sans source de lecture), et un refus peut s'accompagner d'une raison transmise à l'abonné.
 */
@Component({
  selector: 'app-request-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `mat-form-field { width: min(520px, 80vw); } p { margin: 0 0 12px; color: var(--text-2); max-width: 52ch; }`,
  template: `
    @if (data.action === 'Available') {
      <h2 mat-dialog-title>Marquer comme disponible</h2>
      <mat-dialog-content>
        <p>Choisissez le titre du catalogue qui répond à la demande « {{ data.request.name }} ». L'abonné sera averti et pourra le lancer tout de suite.</p>
        <mat-form-field>
          <mat-label>Titre du catalogue</mat-label>
          <input matInput [formControl]="query" [matAutocomplete]="auto" autocomplete="off" />
          <mat-autocomplete #auto="matAutocomplete" [displayWith]="display" (optionSelected)="picked.set($event.option.value)">
            @for (t of options(); track t.id) { <mat-option [value]="t">{{ t.name }} <small class="note">({{ t.year }})</small></mat-option> }
          </mat-autocomplete>
          <mat-hint>Seuls les titres lisibles sont proposés.</mat-hint>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>Annuler</button>
        <button matButton="filled" type="button" [disabled]="!picked()" (click)="ref.close({ titleId: picked()!.id })">Confirmer</button>
      </mat-dialog-actions>
    } @else {
      <h2 mat-dialog-title>Refuser la demande</h2>
      <mat-dialog-content>
        <p>« {{ data.request.name }} » sera refusée. Vous pouvez expliquer pourquoi : le message est transmis à l'abonné.</p>
        <mat-form-field>
          <mat-label>Raison (facultative)</mat-label>
          <textarea matInput rows="3" [formControl]="reason" maxlength="300"></textarea>
        </mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>Annuler</button>
        <button matButton="filled" type="button" (click)="ref.close({ reason: reason.value.trim() || undefined })">Refuser</button>
      </mat-dialog-actions>
    }
  `,
})
export class RequestDialog {
  protected readonly data = inject<RequestActionData>(MAT_DIALOG_DATA);
  protected readonly ref = inject(MatDialogRef<RequestDialog, RequestActionResult>);
  private readonly admin = inject(AdminService);

  protected readonly reason = new FormControl('', { nonNullable: true });
  protected readonly picked = signal<AdminTitle | null>(null);
  protected readonly query = new FormControl<string | AdminTitle>(this.data.request.name, { nonNullable: true });

  protected readonly display = (t: AdminTitle | string | null) => (typeof t === 'string' ? t : (t?.name ?? ''));

  protected readonly options = toSignal(
    this.query.valueChanges.pipe(
      startWith(this.query.value),
      map(v => (typeof v === 'string' ? v.trim() : v.name)),
      debounceTime(200),
      distinctUntilChanged(),
      switchMap(q => (this.data.action === 'Available' && q.length >= 2
        ? this.admin.titles({ q, pageSize: 12 }).pipe(map(p => p.items.filter(t => t.isPlayable)), catchError(() => of([] as AdminTitle[])))
        : of([] as AdminTitle[]))),
    ),
    { initialValue: [] as AdminTitle[] },
  );

  constructor() {
    // Taper à nouveau après un choix annule le choix : on ne confirme jamais un titre qui n'est plus celui affiché.
    this.query.valueChanges.subscribe(v => { if (typeof v === 'string') this.picked.set(null); });
  }
}
