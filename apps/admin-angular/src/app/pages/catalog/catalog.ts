import { Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { combineLatest, debounceTime, distinctUntilChanged, filter, startWith, switchMap, map, catchError, of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import type { Title } from '../../core/models';
import { TitlesService } from '../../core/titles.service';
import { TitleDialog } from './title-dialog';

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatButtonModule, MatFormFieldModule, MatInputModule],
  styles: `
    .bar { display: flex; gap: 1rem; align-items: center; }
    .bar mat-form-field { flex: 1; }
    table { width: 100%; }
  `,
  template: `
    <h1>Catalogue</h1>
    <div class="bar">
      <mat-form-field><mat-label>Rechercher</mat-label><input matInput [formControl]="search" /></mat-form-field>
      @if (auth.isAdmin()) { <button mat-flat-button (click)="edit(null)">Nouveau titre</button> }
    </div>
    <table mat-table [dataSource]="rows()">
      <ng-container matColumnDef="name"><th mat-header-cell *matHeaderCellDef>Nom</th><td mat-cell *matCellDef="let t">{{ t.name }}</td></ng-container>
      <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let t">{{ t.kind === 'Movie' ? 'Film' : 'Série' }}</td></ng-container>
      <ng-container matColumnDef="genre"><th mat-header-cell *matHeaderCellDef>Genre</th><td mat-cell *matCellDef="let t">{{ t.genre }}</td></ng-container>
      <ng-container matColumnDef="year"><th mat-header-cell *matHeaderCellDef>Année</th><td mat-cell *matCellDef="let t">{{ t.year }}</td></ng-container>
      <ng-container matColumnDef="stream"><th mat-header-cell *matHeaderCellDef>Flux</th><td mat-cell *matCellDef="let t">{{ t.streamUrl ? '✓' : '—' }}</td></ng-container>
      <ng-container matColumnDef="actions">
        <th mat-header-cell *matHeaderCellDef></th>
        <td mat-cell *matCellDef="let t">
          @if (auth.isAdmin()) {
            <button mat-button (click)="edit(t)">Modifier</button>
            <button mat-button (click)="remove(t)">Supprimer</button>
          }
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell" [attr.colspan]="columns.length">Aucun titre.</td></tr>
    </table>
    <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1" [hidePageSize]="true" (page)="onPage($event)" />
  `,
})
export class Catalog {
  protected readonly auth = inject(AuthService);
  private readonly titles = inject(TitlesService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly columns = ['name', 'kind', 'genre', 'year', 'stream', 'actions'];
  protected readonly pageSize = 10;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly page = signal(1);
  private readonly reload = signal(0);

  private readonly query$ = this.search.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged());

  private readonly result = toSignal(
    combineLatest([this.query$, toObservable(this.page), toObservable(this.reload)]).pipe(
      switchMap(([q, page]) => this.titles.list({ q, page, pageSize: this.pageSize }).pipe(catchError(() => of(null)))),
      filter(r => r !== null),
    ),
  );
  protected readonly rows = computed(() => this.result()?.items ?? []);
  protected readonly total = computed(() => this.result()?.total ?? 0);

  constructor() {
    // Une nouvelle recherche ramène à la première page.
    this.search.valueChanges.pipe(map(() => 1)).subscribe(p => this.page.set(p));
  }

  protected onPage(e: PageEvent): void { this.page.set(e.pageIndex + 1); }

  protected edit(title: Title | null): void {
    this.dialog.open(TitleDialog, { data: title }).afterClosed().pipe(
      filter(v => !!v),
      switchMap(v => (title ? this.titles.update(title.id, v) : this.titles.create(v))),
    ).subscribe({
      next: () => { this.snack.open('Titre enregistré', 'OK', { duration: 2500 }); this.reload.update(n => n + 1); },
      error: () => this.snack.open("Échec de l'enregistrement", 'OK', { duration: 4000 }),
    });
  }

  protected remove(title: Title): void {
    if (!confirm(`Supprimer « ${title.name} » ?`)) return;
    this.titles.remove(title.id).subscribe({
      next: () => { this.snack.open('Titre supprimé', 'OK', { duration: 2500 }); this.reload.update(n => n + 1); },
      error: () => this.snack.open('Échec de la suppression', 'OK', { duration: 4000 }),
    });
  }
}
