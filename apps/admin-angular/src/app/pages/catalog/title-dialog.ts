import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import type { Title, TitleUpsert } from '../../core/models';

@Component({
  selector: 'app-title-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  styles: `form { display: flex; flex-direction: column; gap: .3rem; min-width: min(480px, 80vw); }`,
  template: `
    <h2 mat-dialog-title>{{ data ? 'Modifier le titre' : 'Nouveau titre' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="name" maxlength="200" /></mat-form-field>
        <mat-form-field><mat-label>Synopsis</mat-label><textarea matInput rows="3" formControlName="synopsis"></textarea></mat-form-field>
        <mat-form-field><mat-label>Type</mat-label>
          <mat-select formControlName="kind"><mat-option value="Movie">Film</mat-option><mat-option value="Series">Série</mat-option></mat-select>
        </mat-form-field>
        <mat-form-field><mat-label>Genre</mat-label><input matInput formControlName="genre" /></mat-form-field>
        <mat-form-field><mat-label>Année</mat-label><input matInput type="number" formControlName="year" /></mat-form-field>
        <mat-form-field><mat-label>Durée (min)</mat-label><input matInput type="number" formControlName="durationMinutes" /></mat-form-field>
        <mat-form-field><mat-label>URL de l'affiche</mat-label><input matInput formControlName="posterUrl" /></mat-form-field>
        <mat-form-field><mat-label>URL du flux HLS (.m3u8)</mat-label><input matInput formControlName="streamUrl" /></mat-form-field>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid">Enregistrer</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class TitleDialog {
  protected readonly data = inject<Title | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TitleDialog, TitleUpsert>);
  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data?.name ?? '', [Validators.required, Validators.maxLength(200)]],
    synopsis: [this.data?.synopsis ?? ''],
    kind: [this.data?.kind ?? 'Movie', Validators.required],
    genre: [this.data?.genre ?? '', Validators.required],
    year: [this.data?.year ?? new Date().getFullYear(), [Validators.required, Validators.min(1888)]],
    durationMinutes: [this.data?.durationMinutes ?? 90, [Validators.required, Validators.min(1)]],
    posterUrl: [this.data?.posterUrl ?? ''],
    streamUrl: [this.data?.streamUrl ?? ''],
  });

  save(): void {
    const v = this.form.getRawValue();
    this.ref.close({ ...v, posterUrl: v.posterUrl || null, streamUrl: v.streamUrl || null } as TitleUpsert);
  }
}
