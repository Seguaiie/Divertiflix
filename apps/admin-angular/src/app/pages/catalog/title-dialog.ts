import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { map, startWith } from 'rxjs';
import type { AdminTitle, TitleUpsert } from '../../core/models';
import { fromTitle, toUpsert } from '../../core/title-form';

@Component({
  selector: 'app-title-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-top: 6px; }
    .full { grid-column: 1 / -1; }
    h3 { grid-column: 1 / -1; font-family: var(--font-ui); font-size: 0.6875rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); margin: 14px 0 8px; font-weight: 600; }
    h3:first-child { margin-top: 0; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  `,
  template: `
    <h2 mat-dialog-title>{{ data ? 'Modifier le titre' : 'Nouveau titre' }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()">
      <mat-dialog-content>
        <div class="grid">
          <h3>Identité</h3>
          <mat-form-field class="full"><mat-label>Nom</mat-label><input matInput formControlName="name" maxlength="200" required /></mat-form-field>
          <mat-form-field><mat-label>Type</mat-label>
            <mat-select formControlName="kind"><mat-option value="Movie">Film</mat-option><mat-option value="Series">Série</mat-option><mat-option value="Audiobook">Livre audio</mat-option></mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>Genre</mat-label><input matInput formControlName="genre" maxlength="60" required /></mat-form-field>
          <mat-form-field><mat-label>Année</mat-label><input matInput type="number" formControlName="year" min="1888" max="2200" /></mat-form-field>
          <mat-form-field><mat-label>Durée (minutes)</mat-label><input matInput type="number" formControlName="durationMinutes" min="0" max="6000" /></mat-form-field>
          <mat-form-field class="full"><mat-label>Synopsis</mat-label><textarea matInput rows="3" formControlName="synopsis" maxlength="4000"></textarea></mat-form-field>

          <h3>{{ isBook() ? 'Livre audio' : 'Distribution' }}</h3>
          @if (isBook()) {
            <mat-form-field><mat-label>Auteur</mat-label><input matInput formControlName="author" maxlength="200" /></mat-form-field>
            <mat-form-field><mat-label>Narrateur</mat-label><input matInput formControlName="narrator" maxlength="200" /></mat-form-field>
          } @else {
            <mat-form-field class="full"><mat-label>Réalisation</mat-label><input matInput formControlName="director" maxlength="200" /></mat-form-field>
          }
          <mat-form-field class="full"><mat-label>Distribution</mat-label><input matInput formControlName="cast" />
            <mat-hint>Noms séparés par des virgules</mat-hint></mat-form-field>
          <mat-form-field class="full"><mat-label>Mots-clés</mat-label><input matInput formControlName="keywords" />
            <mat-hint>Ambiances, thèmes, époque : ils alimentent les recommandations et l'assistant</mat-hint></mat-form-field>

          <h3>Médias</h3>
          <mat-form-field class="full"><mat-label>URL de l'affiche</mat-label><input matInput formControlName="posterUrl" maxlength="500" /></mat-form-field>
          <mat-form-field class="full"><mat-label>URL du fond (bandeau)</mat-label><input matInput formControlName="backdropUrl" maxlength="500" /></mat-form-field>
          <mat-form-field class="full"><mat-label>Source de lecture</mat-label><input matInput formControlName="streamUrl" maxlength="1000" />
            <mat-hint>Flux HLS (.m3u8), vidéo, audio ou lien externe. Vide : le titre n'est pas encore lisible.</mat-hint></mat-form-field>

          <h3>Informations</h3>
          <mat-form-field><mat-label>Classification</mat-label>
            <mat-select formControlName="maturity"><mat-option value="">Non précisée</mat-option>@for (m of maturities; track m) { <mat-option [value]="m">{{ m }}</mat-option> }</mat-select>
          </mat-form-field>
          <mat-form-field><mat-label>Note sur 10</mat-label><input matInput type="number" formControlName="rating" min="0" max="10" step="0.1" /></mat-form-field>
          <mat-form-field class="full"><mat-label>Crédits et licence</mat-label><input matInput formControlName="credits" maxlength="300" />
            <mat-hint>Obligatoire pour les contenus sous licence CC BY, par exemple « © Blender Foundation, CC BY 3.0 »</mat-hint></mat-form-field>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button matButton type="button" mat-dialog-close>Annuler</button>
        <button matButton="filled" type="submit" [disabled]="form.invalid">Enregistrer</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class TitleDialog {
  protected readonly data = inject<AdminTitle | null>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<TitleDialog, TitleUpsert>);
  protected readonly maturities = ['TP', '8+', '13+', '16+', '18+'];

  readonly form = inject(FormBuilder).nonNullable.group((() => {
    const v = fromTitle(this.data);
    return {
      name: [v.name, [Validators.required, Validators.maxLength(200)]],
      synopsis: [v.synopsis, Validators.maxLength(4000)],
      kind: [v.kind, Validators.required],
      genre: [v.genre, [Validators.required, Validators.maxLength(60)]],
      year: [v.year, [Validators.required, Validators.min(1888), Validators.max(2200)]],
      durationMinutes: [v.durationMinutes, [Validators.required, Validators.min(0), Validators.max(6000)]],
      posterUrl: [v.posterUrl], backdropUrl: [v.backdropUrl], streamUrl: [v.streamUrl],
      author: [v.author], narrator: [v.narrator], director: [v.director],
      rating: [v.rating as number | null, [Validators.min(0), Validators.max(10)]],
      maturity: [v.maturity], credits: [v.credits], keywords: [v.keywords], cast: [v.cast],
    };
  })());

  private readonly kind = toSignal(this.form.controls.kind.valueChanges.pipe(startWith(this.form.controls.kind.value), map(k => k)), { initialValue: this.form.controls.kind.value });
  protected readonly isBook = computed(() => this.kind() === 'Audiobook');

  save(): void {
    if (this.form.invalid) return;
    this.ref.close(toUpsert(this.form.getRawValue()));
  }
}
