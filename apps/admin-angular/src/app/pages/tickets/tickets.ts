import { ChangeDetectionStrategy, Component, computed, inject, Injector, signal } from '@angular/core';
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
import { restoreLostFocus } from '../../core/focus';
import { LiveService } from '../../core/live.service';
import type { AdminTicket, TicketCategory, TicketStatus } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { LoadError } from '../../shared/load-error';
import { Icon } from '../../shared/icon';
import { TicketDialog } from './ticket-dialog';

type Filter = 'active' | 'all' | TicketStatus;

@Component({
  selector: 'app-tickets',
  imports: [MatTableModule, MatButtonModule, MatButtonToggleModule, MatProgressBarModule, MatTooltipModule, Icon, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .actions { width: 1%; white-space: nowrap; }
    /* « il y a 4 heures » sur une ligne quand le panneau a la place (sinon le tableau déborderait). */
    @container (min-width: 1000px) { td.mat-column-updated, th.mat-column-updated { white-space: nowrap; } }
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
          <table mat-table class="stack-940" [dataSource]="rows()" [trackBy]="trackById">
            <ng-container matColumnDef="subject">
              <th mat-header-cell *matHeaderCellDef>Sujet</th>
              <td mat-cell *matCellDef="let t"><span class="cell-main">{{ t.ticket.subject }}</span><span class="cell-sub">{{ category(t.ticket.category) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="requester"><th mat-header-cell *matHeaderCellDef>Abonné</th><td mat-cell *matCellDef="let t" data-label="Abonné">{{ t.requester }}</td></ng-container>
            <ng-container matColumnDef="messages"><th mat-header-cell *matHeaderCellDef>Messages</th><td mat-cell *matCellDef="let t" class="tnum" data-label="Messages">{{ t.messages }}</td></ng-container>
            <ng-container matColumnDef="status">
              <th mat-header-cell *matHeaderCellDef>État</th>
              <td mat-cell *matCellDef="let t"><span class="chip" [attr.data-tone]="tone(t.ticket.status)">{{ label(t.ticket.status) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="updated">
              <th mat-header-cell *matHeaderCellDef>Mis à jour</th>
              <td mat-cell *matCellDef="let t" data-label="Mis à jour"><span [matTooltip]="exact(t.ticket.updatedAt)">{{ ago(t.ticket.updatedAt) }}</span></td>
            </ng-container>
            <ng-container matColumnDef="actions">
              <th mat-header-cell *matHeaderCellDef class="actions"><span class="visually-hidden">Actions</span></th>
              <td mat-cell *matCellDef="let t" class="actions"><button matButton="outlined" type="button" [attr.aria-label]="'Ouvrir le billet : ' + t.ticket.subject" (click)="open(t); $event.stopPropagation()"><app-icon name="send" />Ouvrir</button></td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns" (click)="open(row)"></tr>
          </table>
        </div>
        @if (!loading() && failed() && rows().length === 0) {
          <app-load-error message="Les billets n'ont pas pu être lus : ce n'est pas une liste vide." (retry)="retry()" />
        } @else if (!loading() && rows().length === 0) {
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
  private readonly injector = inject(Injector);

  protected readonly label = (s: TicketStatus) => TICKET_LABEL[s];
  protected readonly tone = (s: TicketStatus) => TICKET_TONE[s];
  protected readonly category = (c: TicketCategory) => CATEGORY_LABEL[c];
  protected readonly ago = ago;
  protected readonly exact = exact;
  // Lignes réutilisées d'un rechargement à l'autre : le focus reste sur le bouton qui a ouvert le fil.
  protected readonly trackById = (_: number, t: AdminTicket) => t.ticket.id;
  protected readonly columns = ['subject', 'requester', 'messages', 'status', 'updated', 'actions'];

  protected readonly filter = signal<Filter>('active');
  protected readonly loading = signal(true);
  /** Le dernier chargement a échoué : une liste vide n'est alors pas « aucun billet à traiter ». */
  protected readonly failed = signal(false);
  private readonly reload = signal(0);
  /** Un fil vient d'être fermé : si le billet a quitté la liste (résolu), le focus clavier est ramené sur la page. */
  private afterClose = false;

  private readonly all = toSignal(
    combineLatest([toObservable(this.reload), toObservable(this.live.tick)]).pipe(
      tap(() => this.loading.set(true)),
      switchMap(() => this.admin.tickets().pipe(
        catchError(e => { this.loading.set(false); this.failed.set(true); this.snack.open(problemMessage(e, 'Chargement des billets impossible.'), 'OK', { duration: 5000 }); return EMPTY; }),
      )),
      tap(() => {
        this.loading.set(false);
        this.failed.set(false);
        if (this.afterClose) { this.afterClose = false; restoreLostFocus(this.injector); }
      }),
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

  protected retry(): void { this.reload.update(n => n + 1); }

  protected open(t: AdminTicket): void {
    // Quelle que soit la façon de fermer (bouton, Échap, clic à côté), la liste relit les billets : une réponse ou un changement d'état a pu avoir lieu.
    this.dialog.open(TicketDialog, { data: t, maxWidth: '96vw', autoFocus: 'textarea' }).afterClosed().subscribe(() => { this.afterClose = true; this.reload.update(n => n + 1); });
  }
}
