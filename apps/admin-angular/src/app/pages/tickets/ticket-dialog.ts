import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AdminService } from '../../core/admin.service';
import { CATEGORY_LABEL, TICKET_LABEL, TICKET_TONE } from '../../core/format';
import { LiveService } from '../../core/live.service';
import type { AdminTicket, TicketDetail, TicketStatus } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { Icon } from '../../shared/icon';

/** Fil d'un billet : l'agent lit la conversation, répond, et fait avancer l'état. Le fil se rafraîchit quand l'abonné écrit. */
@Component({
  selector: 'app-ticket-dialog',
  imports: [DatePipe, ReactiveFormsModule, MatDialogModule, MatButtonModule, MatButtonToggleModule, MatFormFieldModule, MatInputModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; width: min(640px, 92vw); }
    .meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: -4px 0 14px; color: var(--text-3); font-size: 0.8125rem; }
    .thread { display: grid; gap: 10px; max-height: 42vh; overflow-y: auto; padding: 4px 2px 8px; }
    .msg { max-width: 82%; padding: 10px 14px; border-radius: 14px; background: var(--bg-3); border: 1px solid var(--line); justify-self: start; }
    .msg.staff { justify-self: end; background: color-mix(in oklab, var(--accent) 14%, var(--bg-2)); border-color: color-mix(in oklab, var(--accent) 30%, transparent); }
    .msg p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
    .msg small { display: block; margin-top: 4px; color: var(--text-3); font-size: 0.6875rem; }
    .reply { margin-top: 12px; }
    .reply mat-form-field { width: 100%; }
    mat-button-toggle-group { --mat-button-toggle-height: 36px; }
    .status { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  `,
  template: `
    <h2 mat-dialog-title>{{ data.ticket.subject }}</h2>
    <mat-dialog-content>
      <div class="meta">
        <span>{{ data.requester }}</span><span>·</span><span>{{ category[data.ticket.category] }}</span>
        <span class="chip" [attr.data-tone]="tone[status()]">{{ label[status()] }}</span>
      </div>

      <div class="thread" role="log" aria-label="Conversation" aria-live="polite">
        @for (m of detail()?.messages ?? []; track m.id) {
          <div class="msg" [class.staff]="m.fromStaff"><p>{{ m.body }}</p><small>{{ m.fromStaff ? 'Équipe Divertiflix' : data.requester }} · {{ m.at | date: 'd MMM, HH:mm' }}</small></div>
        } @empty { <p class="note">Chargement de la conversation.</p> }
      </div>

      <form class="reply" (ngSubmit)="send()">
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Votre réponse</mat-label>
          <textarea matInput rows="3" [formControl]="body" maxlength="4000" (keydown.control.enter)="send()" (keydown.meta.enter)="send()"></textarea>
          <mat-hint>Ctrl + Entrée pour envoyer. L'abonné est averti en direct.</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions>
      <div class="status">
        <mat-button-toggle-group [value]="status()" (change)="setStatus($event.value)" aria-label="État du billet" hideSingleSelectionIndicator>
          <mat-button-toggle value="Open">Ouvert</mat-button-toggle>
          <mat-button-toggle value="InProgress">En cours</mat-button-toggle>
          <mat-button-toggle value="Resolved">Résolu</mat-button-toggle>
        </mat-button-toggle-group>
      </div>
      <span style="flex:1"></span>
      <button matButton type="button" [mat-dialog-close]="changed()">Fermer</button>
      <button matButton="filled" type="button" [disabled]="body.invalid || sending()" (click)="send()"><app-icon name="send" />Envoyer</button>
    </mat-dialog-actions>
  `,
})
export class TicketDialog {
  protected readonly data = inject<AdminTicket>(MAT_DIALOG_DATA);
  private readonly admin = inject(AdminService);
  private readonly snack = inject(MatSnackBar);
  private readonly live = inject(LiveService);

  protected readonly label = TICKET_LABEL;
  protected readonly tone = TICKET_TONE;
  protected readonly category = CATEGORY_LABEL;
  protected readonly detail = signal<TicketDetail | null>(null);
  protected readonly status = signal<TicketStatus>(this.data.ticket.status);
  protected readonly sending = signal(false);
  /** Vrai dès que l'agent a répondu ou changé l'état : la liste derrière se rafraîchit à la fermeture. */
  protected readonly changed = signal(false);
  protected readonly body = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(4000), c => (String(c.value).trim() ? null : { blank: true })] });

  constructor() {
    // Une réponse de l'abonné pendant que le fil est ouvert apparaît sans rien faire.
    effect(() => { this.live.tick(); untracked(() => this.load()); });
  }

  private load(): void {
    this.admin.ticket(this.data.ticket.id).subscribe({
      next: d => { this.detail.set(d); this.status.set(d.ticket.status); },
      error: e => this.snack.open(problemMessage(e, 'Chargement du billet impossible.'), 'OK', { duration: 5000 }),
    });
  }

  protected send(): void {
    const text = this.body.value.trim();
    if (!text || this.sending()) return;
    this.sending.set(true);
    this.admin.reply(this.data.ticket.id, text).subscribe({
      next: () => { this.sending.set(false); this.body.reset(''); this.changed.set(true); this.load(); },
      error: e => { this.sending.set(false); this.snack.open(problemMessage(e, "Échec de l'envoi."), 'OK', { duration: 6000 }); },
    });
  }

  protected setStatus(s: TicketStatus): void {
    if (s === this.status()) return;
    const before = this.status();
    this.status.set(s);
    this.admin.setTicketStatus(this.data.ticket.id, s).subscribe({
      next: () => { this.changed.set(true); },
      error: e => { this.status.set(before); this.snack.open(problemMessage(e, "Échec du changement d'état."), 'OK', { duration: 6000 }); },
    });
  }
}
