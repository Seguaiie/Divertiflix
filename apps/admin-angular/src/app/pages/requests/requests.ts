import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, combineLatest, EMPTY, filter, switchMap, tap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import { AuthService } from '../../core/auth.service';
import { ago, exact, KIND_LABEL, REQUEST_LABEL, REQUEST_TONE } from '../../core/format';
import { LiveService } from '../../core/live.service';
import type { AdminRequest, RequestStatus, TitleKind } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { ACTION_LABEL, NEXT_STATUS } from '../../core/request-flow';
import { RequestDialog, type RequestActionResult } from './request-dialog';

type Filter = 'active' | 'all' | RequestStatus;
const ACTIVE: RequestStatus[] = ['Pending', 'Approved', 'Downloading'];

@Component({
  selector: 'app-requests',
  imports: [MatTableModule, MatButtonModule, MatButtonToggleModule, MatProgressBarModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .note-text { display: block; margin-top: 4px; color: var(--text-2); font-size: 0.8125rem; max-width: 56ch; font-style: italic; }
    .actions { width: 1%; white-space: nowrap; }
    td.mat-mdc-cell:first-child { min-width: 190px; }
    .row-actions button { --mdc-outlined-button-container-height: 34px; --mat-button-outlined-container-height: 34px; }
    .loading { height: 3px; }
    mat-button-toggle-group { --mat-button-toggle-height: 40px; flex-wrap: wrap; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Contenu</p><h1>Demandes</h1>
          <p>Ce que les abonnés aimeraient voir. Chaque décision envoie une notification en direct à la personne.</p></div>
      </div>

      <div class="toolbar">
        <mat-button-toggle-group [value]="filter()" (change)="filter.set($event.value)" aria-label="Filtrer par état" hideSingleSelectionIndicator>
          <mat-button-toggle value="active">À traiter ({{ counts().active }})</mat-button-toggle>
          <mat-button-toggle value="Pending">En attente ({{ counts().Pending }})</mat-button-toggle>
          <mat-button-toggle value="Available">Disponibles ({{ counts().Available }})</mat-button-toggle>
          <mat-button-toggle value="Declined">Refusées ({{ counts().Declined }})</mat-button-toggle>
          <mat-button-toggle value="all">Toutes ({{ counts().all }})</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="panel">
        <div class="loading">@if (loading()) { <mat-progress-bar mode="indeterminate" aria-label="Chargement" /> }</div>
        <div class="scroll-x">
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="name">
              <th mat-header-cell *matHeaderCellDef>Demande</th>
              <td mat-cell *matCellDef="let r"><span class="cell-main">{{ r.name }}</span>
                <span class="cell-sub">{{ kindLabel(r.kind) }}@if (r.year) { · {{ r.year }} }</span>
                @if (r.note) { <span class="note-text">« {{ r.note }} »</span> }</td>
            </ng-container>
            <ng-container matColumnDef="by">
              <th mat-header-cell *matHeaderCellDef>Demandé par</th>
              <td mat-cell *matCellDef="let r">{{ r.requestedBy }}<span class="cell-sub" [matTooltip]="exact(r.createdAt)">{{ ago(r.createdAt) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>État</th>
              <td mat-cell *matCellDef="let r"><span class="chip" [attr.data-tone]="tone(r.status)">{{ label(r.status) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions"><span class="visually-hidden">Actions</span></th>
              <td mat-cell *matCellDef="let r" class="actions">
                <div class="row-actions">
                  @for (next of nextOf(r); track next) {
                    <button matButton="outlined" type="button" [disabled]="busy() === r.id" (click)="act(r, next)">{{ actionLabel[next] }}</button>
                  }
                </div>
              </td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns()"></tr>
            <tr mat-row *matRowDef="let row; columns: columns()"></tr>
          </table>
        </div>
        @if (!loading() && rows().length === 0) {
          <div class="empty"><strong>Rien à afficher</strong>{{ filter() === 'active' ? 'Aucune demande à traiter pour le moment.' : 'Aucune demande dans cet état.' }}</div>
        }
      </div>
    </div>
  `,
})
export class Requests {
  protected readonly auth = inject(AuthService);
  private readonly admin = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly live = inject(LiveService);

  protected readonly kindLabel = (k: TitleKind) => KIND_LABEL[k];
  protected readonly label = (s: RequestStatus) => REQUEST_LABEL[s];
  protected readonly tone = (s: RequestStatus) => REQUEST_TONE[s];
  protected readonly actionLabel = ACTION_LABEL;
  protected readonly ago = ago;
  protected readonly exact = exact;

  protected readonly filter = signal<Filter>('active');
  protected readonly loading = signal(true);
  protected readonly busy = signal<string | null>(null);
  private readonly reload = signal(0);
  protected readonly columns = computed(() => ['name', 'by', 'status', ...(this.auth.isAdmin() ? ['actions'] : [])]);

  private readonly all = toSignal(
    combineLatest([toObservable(this.reload), toObservable(this.live.tick)]).pipe(
      tap(() => this.loading.set(true)),
      switchMap(() => this.admin.requests().pipe(
        catchError(e => { this.loading.set(false); this.snack.open(problemMessage(e, 'Chargement des demandes impossible.'), 'OK', { duration: 5000 }); return EMPTY; }),
      )),
      tap(() => this.loading.set(false)),
    ),
    { initialValue: [] as AdminRequest[] },
  );

  protected readonly counts = computed(() => {
    const list = this.all();
    const by = (s: RequestStatus) => list.filter(r => r.status === s).length;
    return { active: list.filter(r => ACTIVE.includes(r.status)).length, Pending: by('Pending'), Available: by('Available'), Declined: by('Declined'), all: list.length };
  });

  protected readonly rows = computed(() => {
    const f = this.filter();
    return this.all().filter(r => (f === 'all' ? true : f === 'active' ? ACTIVE.includes(r.status) : r.status === f));
  });

  protected nextOf(r: AdminRequest): readonly RequestStatus[] { return NEXT_STATUS[r.status]; }

  protected act(r: AdminRequest, next: RequestStatus): void {
    if (next === 'Available' || next === 'Declined') {
      this.dialog.open(RequestDialog, { data: { request: r, action: next } }).afterClosed().pipe(
        filter((v): v is RequestActionResult => !!v),
      ).subscribe(v => this.apply(r, next, v));
    } else this.apply(r, next, {});
  }

  private apply(r: AdminRequest, status: RequestStatus, extra: RequestActionResult): void {
    this.busy.set(r.id);
    this.admin.updateRequest(r.id, { status, titleId: extra.titleId, reason: extra.reason }).subscribe({
      next: () => { this.busy.set(null); this.snack.open(`« ${r.name} » : ${REQUEST_LABEL[status].toLowerCase()}`, 'OK', { duration: 3000 }); this.reload.update(n => n + 1); },
      error: e => { this.busy.set(null); this.snack.open(problemMessage(e, 'Action impossible.'), 'OK', { duration: 6000 }); this.reload.update(n => n + 1); },
    });
  }
}
