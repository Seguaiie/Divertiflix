import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, EMPTY, filter, startWith, switchMap, tap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { KIND_LABEL } from '../../core/format';
import type { AdminTitle, TitleKind } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ConfirmDialog } from '../../shared/confirm-dialog';
import { Icon } from '../../shared/icon';
import { TitleDialog } from './title-dialog';

const STREAM_LABEL: Record<string, string> = { Hls: 'HLS', Video: 'Vidéo', Audio: 'Audio', External: 'Lien externe' };

@Component({
  selector: 'app-catalog',
  imports: [ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, MatProgressBarModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .thumb { width: 36px; height: 52px; border-radius: 4px; object-fit: cover; background: var(--bg-3); flex: none; }
    .cell-title { display: flex; align-items: center; gap: 12px; min-width: 220px; }
    .actions { width: 1%; white-space: nowrap; }
    mat-button-toggle-group { --mat-button-toggle-height: 40px; }
    .loading { height: 3px; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Contenu</p><h1>Catalogue</h1>
          <p>Films, séries et livres audio. Un titre sans source de lecture reste visible pour être demandé, mais ne se lance pas.</p></div>
        @if (auth.isAdmin()) { <button matButton="filled" type="button" (click)="edit(null)"><app-icon name="plus" />Nouveau titre</button> }
      </div>

      <div class="toolbar">
        <mat-form-field class="grow" subscriptSizing="dynamic">
          <mat-label>Rechercher un titre, un auteur, un genre</mat-label>
          <input matInput type="search" [formControl]="search" />
        </mat-form-field>
        <mat-button-toggle-group [value]="kind()" (change)="setKind($event.value)" aria-label="Type de contenu" hideSingleSelectionIndicator>
          <mat-button-toggle value="">Tous</mat-button-toggle>
          <mat-button-toggle value="Movie">Films</mat-button-toggle>
          <mat-button-toggle value="Series">Séries</mat-button-toggle>
          <mat-button-toggle value="Audiobook">Livres audio</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="panel">
        <div class="loading">@if (loading()) { <mat-progress-bar mode="indeterminate" aria-label="Chargement" /> }</div>
        <div class="scroll-x">
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Titre</th>
              <td mat-cell *matCellDef="let t"><div class="cell-title">
                @if (t.posterUrl) { <img class="thumb" [src]="t.posterUrl" alt="" loading="lazy" width="36" height="52" /> } @else { <span class="thumb"></span> }
                <span><span class="cell-main">{{ t.name }}</span><span class="cell-sub">{{ subtitle(t) }}</span></span></div></td>
            </ng-container>
            <ng-container matColumnDef="kind"><th mat-header-cell *matHeaderCellDef>Type</th><td mat-cell *matCellDef="let t">{{ kindLabel(t.kind) }}</td></ng-container>
            <ng-container matColumnDef="duration"><th mat-header-cell *matHeaderCellDef>Durée</th><td mat-cell *matCellDef="let t" class="tnum">{{ t.durationMinutes }} min</td></ng-container>
            <ng-container matColumnDef="source">
              <th mat-header-cell *matHeaderCellDef>Lecture</th>
              <td mat-cell *matCellDef="let t">
                @if (t.isPlayable) { <span class="chip" data-tone="ok">{{ streamLabel(t) }}</span> } @else { <span class="chip" data-tone="muted">Sans source</span> }
              </td>
            </ng-container>
            <ng-container matColumnDef="origin"><th mat-header-cell *matHeaderCellDef>Origine</th><td mat-cell *matCellDef="let t">{{ t.externalSource ?? 'Manuel' }}</td></ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions"><span class="visually-hidden">Actions</span></th>
              <td mat-cell *matCellDef="let t" class="actions">
                <div class="row-actions">
                  <button matIconButton type="button" (click)="edit(t)" [attr.aria-label]="'Modifier ' + t.name"><app-icon name="edit" /></button>
                  <button matIconButton type="button" (click)="remove(t)" [attr.aria-label]="'Supprimer ' + t.name"><app-icon name="trash" /></button>
                </div>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns()"></tr>
            <tr mat-row *matRowDef="let row; columns: columns()"></tr>
          </table>
        </div>
        @if (!loading() && rows().length === 0) {
          <div class="empty"><strong>Aucun titre</strong>Essayez une autre recherche ou un autre type.</div>
        }
        <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1" [hidePageSize]="true" (page)="onPage($event)" aria-label="Pagination du catalogue" />
      </div>
    </div>
  `,
})
export class Catalog {
  protected readonly auth = inject(AuthService);
  private readonly admin = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly kindLabel = (k: TitleKind) => KIND_LABEL[k];
  protected readonly columns = computed(() => ['name', 'kind', 'duration', 'source', 'origin', ...(this.auth.isAdmin() ? ['actions'] : [])]);
  protected readonly pageSize = 12;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly kind = signal<TitleKind | ''>('');
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  private readonly reload = signal(0);

  private readonly query$ = this.search.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged());

  private readonly result = toSignal(
    combineLatest([this.query$, toObservable(this.kind), toObservable(this.page), toObservable(this.reload)]).pipe(
      tap(() => this.loading.set(true)),
      switchMap(([q, kind, page]) => this.admin.titles({ q, kind: kind || undefined, page, pageSize: this.pageSize }).pipe(
        catchError(e => { this.loading.set(false); this.snack.open(problemMessage(e, 'Chargement du catalogue impossible.'), 'OK', { duration: 5000 }); return EMPTY; }),
      )),
      tap(() => this.loading.set(false)),
    ),
  );
  protected readonly rows = computed(() => this.result()?.items ?? []);
  protected readonly total = computed(() => this.result()?.total ?? 0);

  protected subtitle(t: AdminTitle): string {
    return [t.kind === 'Audiobook' ? t.author : String(t.year), t.genre].filter(Boolean).join(' · ');
  }
  protected streamLabel(t: AdminTitle): string { return STREAM_LABEL[t.streamKind ?? ''] ?? 'Disponible'; }

  protected setKind(k: TitleKind | ''): void { this.kind.set(k); this.page.set(1); }
  protected onPage(e: PageEvent): void { this.page.set(e.pageIndex + 1); }

  constructor() {
    // Une nouvelle recherche ramène à la première page.
    this.search.valueChanges.pipe(debounceTime(300)).subscribe(() => this.page.set(1));
  }

  protected edit(title: AdminTitle | null): void {
    this.dialog.open(TitleDialog, { data: title, width: '760px', maxWidth: '96vw', autoFocus: 'first-tabbable' }).afterClosed().pipe(
      filter(v => !!v),
      switchMap(v => (title ? this.admin.updateTitle(title.id, v) : this.admin.createTitle(v)).pipe(
        catchError(e => { this.snack.open(problemMessage(e, "Échec de l'enregistrement."), 'OK', { duration: 6000 }); return EMPTY; }),
      )),
    ).subscribe(() => { this.snack.open('Titre enregistré', 'OK', { duration: 2500 }); this.reload.update(n => n + 1); });
  }

  protected remove(title: AdminTitle): void {
    this.dialog.open(ConfirmDialog, {
      data: { title: 'Supprimer ce titre ?', message: `« ${title.name} » sera retiré du catalogue, ainsi que les listes, notes et reprises qui le concernent. Cette action est définitive.`, confirm: 'Supprimer', danger: true },
    }).afterClosed().pipe(
      filter(v => v === true),
      switchMap(() => this.admin.deleteTitle(title.id).pipe(
        catchError(e => { this.snack.open(problemMessage(e, 'Échec de la suppression.'), 'OK', { duration: 6000 }); return EMPTY; }),
      )),
    ).subscribe(() => { this.snack.open('Titre supprimé', 'OK', { duration: 2500 }); this.reload.update(n => n + 1); });
  }
}
