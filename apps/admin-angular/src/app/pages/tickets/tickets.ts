import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, combineLatest, EMPTY, switchMap, tap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import { ago, CATEGORY_LABEL, exact, TICKET_LABEL, TICKET_TONE } from '../../core/format';
import { LiveService } from '../../core/live.service';
import type { AdminTicket, TicketCategory, TicketStatus } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { Icon } from '../../shared/icon';
import { TicketDialog } from './ticket-dialog';

type Filter = 'active' | 'all' | TicketStatus;

@Component({
  selector: 'app-tickets',
  imports: [MatTableModule, MatButtonModule, MatButtonToggleModule, MatProgressBarModule, MatTooltipModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .actions { width: 1%; white-space: nowrap; }
    .loading { height: 3px; }
    mat-button-toggle-group { --mat-button-toggle-height: 40px; flex-wrap: wrap; }
    tr.mat-mdc-row { cursor: pointer; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Assistance</p><h1>Billets d'aide</h1>
          <p>Les questions des abonnés. Répondez depuis le fil : la personne reçoit la réponse en direct dans le portail.</p></div>
      </div>

      <div class="toolbar">
        <mat-button-toggle-group [value]="filter()" (change)="filter.set($event.value)" aria-label="Filtrer par état" hideSingleSelectionIndicator>
          <mat-button-toggle value="active">À traiter ({{ counts().active }})</mat-button-toggle>
          <mat-button-toggle value="Open">Ouverts ({{ counts().Open }})</mat-button-toggle>
          <mat-button-toggle value="InProgress">En cours ({{ counts().InProgress }})</mat-button-toggle>
          <mat-button-toggle value="Resolved">Résolus ({{ counts().Resolved }})</mat-button-toggle>
          <mat-button-toggle value="all">Tous ({{ counts().all }})</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      <div class="panel">
        <div class="loading">@if (loading()) { <mat-progress-bar mode="indeterminate" aria-label="Chargement" /> }</div>
        <div class="scroll-x">
          <table mat-table [dataSource]="rows()">
            <ng-container matColumnDef="subject">
              <th mat-header-cell *matHeaderCellDef>Sujet</th>
              <td mat-cell *matCellDef="let t"><span class="cell-main">{{ t.ticket.subject }}</span><span class="cell-sub">{{ category(t.ticket.category) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="requester"><th mat-header-cell *matHeaderCellDef>Abonné</th><td mat-cell *matCellDef="let t">{{ t.requester }}</td></ng-container>
            <ng-container matColumnDef="messages"><th mat-header-cell *matHeaderCellDef>Messages</th><td mat-cell *matCellDef="let t" class="tnum">{{ t.messages }}</td></ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>État</th>
              <td mat-cell *matCellDef="let t"><span class="chip" [attr.data-tone]="tone(t.ticket.status)">{{ label(t.ticket.status) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="updated">
              <th mat-header-cell *matHeaderCellDef>Mis à jour</th>
              <td mat-cell *matCellDef="let t"><span [matTooltip]="exact(t.ticket.updatedAt)">{{ ago(t.ticket.updatedAt) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions"><span class="visually-hidden">Actions</span></th>
              <td mat-cell *matCellDef="let t" class="actions"><button matButton="outlined" type="button" (click)="open(t); $event.stopPropagation()"><app-icon name="send" />Ouvrir</button></td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns" (click)="open(row)"></tr>
          </table>
        </div>
        @if (!loading() && rows().length === 0) {
          <div class="empty"><strong>Rien à afficher</strong>{{ filter() === 'active' ? 'Aucun billet à traiter. Bon travail.' : 'Aucun billet dans cet état.' }}</div>
        }
      </div>
    </div>
  `,
})
export class Tickets {
  private readonly admin = inject(AdminService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly live = inject(LiveService);

  protected readonly label = (s: TicketStatus) => TICKET_LABEL[s];
  protected readonly tone = (s: TicketStatus) => TICKET_TONE[s];
  protected readonly category = (c: TicketCategory) => CATEGORY_LABEL[c];
  protected readonly ago = ago;
  protected readonly exact = exact;
  protected readonly columns = ['subject', 'requester', 'messages', 'status', 'updated', 'actions'];

  protected readonly filter = signal<Filter>('active');
  protected readonly loading = signal(true);
  private readonly reload = signal(0);

  private readonly all = toSignal(
    combineLatest([toObservable(this.reload), toObservable(this.live.tick)]).pipe(
      tap(() => this.loading.set(true)),
      switchMap(() => this.admin.tickets().pipe(
        catchError(e => { this.loading.set(false); this.snack.open(problemMessage(e, 'Chargement des billets impossible.'), 'OK', { duration: 5000 }); return EMPTY; }),
      )),
      tap(() => this.loading.set(false)),
    ),
    { initialValue: [] as AdminTicket[] },
  );

  protected readonly counts = computed(() => {
    const list = this.all();
    const by = (s: TicketStatus) => list.filter(t => t.ticket.status === s).length;
    return { active: list.filter(t => t.ticket.status !== 'Resolved').length, Open: by('Open'), InProgress: by('InProgress'), Resolved: by('Resolved'), all: list.length };
  });

  protected readonly rows = computed(() => {
    const f = this.filter();
    return this.all().filter(t => (f === 'all' ? true : f === 'active' ? t.ticket.status !== 'Resolved' : t.ticket.status === f));
  });

  protected open(t: AdminTicket): void {
    this.dialog.open(TicketDialog, { data: t, maxWidth: '96vw', autoFocus: 'textarea' }).afterClosed().subscribe(changed => { if (changed) this.reload.update(n => n + 1); });
  }
}
