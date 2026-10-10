import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule, type MatSelectChange } from '@angular/material/select';
import { MatSlideToggleModule, type MatSlideToggleChange } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { catchError, combineLatest, debounceTime, distinctUntilChanged, EMPTY, startWith, switchMap, tap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { day, ROLE_LABEL, SOURCE_LABEL } from '../../core/format';
import type { AdminUser, Role } from '../../core/models';
import { PaginatorFr } from '../../core/paginator-fr';
import { problemMessage } from '../../core/problem';
import { LoadError } from '../../shared/load-error';

@Component({
  selector: 'app-users',
  imports: [ReactiveFormsModule, MatTableModule, MatPaginatorModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSlideToggleModule, MatProgressBarModule, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: MatPaginatorIntl, useClass: PaginatorFr }],
  styles: `
    .loading { height: 3px; }
    mat-select { min-width: 150px; }
    mat-select:focus-visible { outline: 2px solid var(--accent-hi); outline-offset: 4px; border-radius: 4px; }
    .inactive .cell-main { color: var(--text-3); text-decoration: line-through; text-decoration-color: var(--line-strong); }
    .you { margin-left: 8px; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Administration</p><h1>Utilisateurs</h1>
          <p>Rôles et accès. Un compte désactivé ne peut plus se connecter et perd ses sessions tout de suite ; ses données sont conservées.</p></div>
      </div>

      <div class="toolbar">
        <mat-form-field class="grow" subscriptSizing="dynamic">
          <mat-label>Rechercher par courriel</mat-label>
          <input matInput type="search" [formControl]="search" />
        </mat-form-field>
      </div>

      <div class="panel">
        <div class="loading">@if (loading()) { <mat-progress-bar mode="indeterminate" aria-label="Chargement" /> }</div>
        <div class="scroll-x">
          <table mat-table class="stack-800" [dataSource]="rows()" [trackBy]="trackById">
            <ng-container matColumnDef="email">
              <th mat-header-cell *matHeaderCellDef>Compte</th>
              <td mat-cell *matCellDef="let u" [class.inactive]="!u.isActive">
                <span class="cell-main">{{ u.email }}</span>@if (u.id === me()) { <span class="chip you" data-tone="info">Vous</span> }
                <span class="cell-sub">Créé le {{ day(u.createdAt) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="role">
              <th mat-header-cell *matHeaderCellDef>Rôle</th>
              <td mat-cell *matCellDef="let u" data-label="Rôle">
                <mat-select [value]="u.role" (selectionChange)="setRole(u, $event)" [disabled]="u.id === me()" [aria-label]="'Rôle de ' + u.email" panelClass="role-panel">
                  @for (r of roles; track r) { <mat-option [value]="r">{{ roleLabel[r] }}</mat-option> }
                </mat-select>
              </td>
            </ng-container>
            <ng-container matColumnDef="source"><th mat-header-cell *matHeaderCellDef>Origine</th><td mat-cell *matCellDef="let u" data-label="Origine"><span class="chip" [attr.data-tone]="u.source === 'Local' ? 'muted' : 'info'">{{ sourceLabel(u.source) }}</span></td></ng-container>
            <ng-container matColumnDef="profiles"><th mat-header-cell *matHeaderCellDef>Profils</th><td mat-cell *matCellDef="let u" class="tnum" data-label="Profils">{{ u.profiles }}</td></ng-container>
            <ng-container matColumnDef="active">
              <th mat-header-cell *matHeaderCellDef>Actif</th>
              <td mat-cell *matCellDef="let u" data-label="Actif">
                <mat-slide-toggle [checked]="u.isActive" (change)="setActive(u, $event)" [disabled]="u.id === me()" [aria-label]="'Compte actif : ' + u.email" hideIcon />
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
        @if (!loading() && failed() && rows().length === 0) {
          <app-load-error message="Les comptes n'ont pas pu être lus : ce n'est pas une liste vide." (retry)="retry()" />
        } @else if (!loading() && rows().length === 0) { <div class="empty"><strong>Aucun compte</strong>Essayez une autre recherche.</div> }
        <mat-paginator [length]="total()" [pageSize]="pageSize" [pageIndex]="page() - 1" [hidePageSize]="true" (page)="onPage($event)" aria-label="Pagination des comptes" />
      </div>
    </div>
  `,
})
export class Users {
  private readonly admin = inject(AdminService);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);

  protected readonly roles: Role[] = ['Subscriber', 'Support', 'Admin'];
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly day = day;
  // Lignes réutilisées d'un rechargement à l'autre : le focus reste sur la commande qu'on vient d'actionner.
  protected readonly trackById = (_: number, u: AdminUser) => u.id;
  protected readonly sourceLabel = (s: AdminUser['source']) => SOURCE_LABEL[s];
  protected readonly columns = ['email', 'role', 'source', 'profiles', 'active'];
  protected readonly pageSize = 15;
  protected readonly search = new FormControl('', { nonNullable: true });
  protected readonly page = signal(1);
  protected readonly loading = signal(true);
  /** Le dernier chargement a échoué : une liste vide n'est alors pas « aucun compte ». */
  protected readonly failed = signal(false);
  protected readonly busy = signal<string | null>(null);
  protected readonly me = computed(() => this.auth.user()?.id);
  private readonly reload = signal(0);

  private readonly result = toSignal(
    combineLatest([this.search.valueChanges.pipe(startWith(''), debounceTime(300), distinctUntilChanged()), toObservable(this.page), toObservable(this.reload)]).pipe(
      tap(() => this.loading.set(true)),
      switchMap(([q, page]) => this.admin.users({ q, page, pageSize: this.pageSize }).pipe(
        catchError(e => { this.loading.set(false); this.failed.set(true); this.snack.open(problemMessage(e, 'Chargement des comptes impossible.'), 'OK', { duration: 5000 }); return EMPTY; }),
      )),
      tap(() => { this.loading.set(false); this.failed.set(false); }),
    ),
  );
  protected readonly rows = computed(() => this.result()?.items ?? []);
  protected readonly total = computed(() => this.result()?.total ?? 0);

  constructor() { this.search.valueChanges.pipe(debounceTime(300)).subscribe(() => this.page.set(1)); }

  protected onPage(e: PageEvent): void { this.page.set(e.pageIndex + 1); }
  protected retry(): void { this.reload.update(n => n + 1); }

  protected setRole(u: AdminUser, e: MatSelectChange): void { this.update(u, { role: e.value }, () => (e.source.value = u.role)); }
  protected setActive(u: AdminUser, e: MatSlideToggleChange): void { this.update(u, { isActive: e.checked }, () => (e.source.checked = u.isActive)); }

  private update(u: AdminUser, patch: { role?: Role; isActive?: boolean }, revert: () => void): void {
    // Les commandes restent actives pendant l'envoi (les désactiver ferait perdre le focus clavier) : un second changement est ignoré.
    if (this.busy()) { revert(); return; }
    this.busy.set(u.id);
    this.admin.updateUser(u.id, patch).subscribe({
      next: () => { this.busy.set(null); this.snack.open(`${u.email} mis à jour`, 'OK', { duration: 2500 }); this.reload.update(n => n + 1); },
      // Le serveur reste l'autorité (dernier administrateur, compte propre...) : on affiche son message, on remet la commande
      // dans son état d'origine (la ligne étant réutilisée, sa valeur liée ne change pas) et on relit l'état réel.
      error: e => { revert(); this.busy.set(null); this.snack.open(problemMessage(e, 'Modification impossible.'), 'OK', { duration: 6000 }); this.reload.update(n => n + 1); },
    });
  }
}
