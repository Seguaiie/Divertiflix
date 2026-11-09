import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { interval } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AdminService } from '../../core/admin.service';
import type { ServiceProbe } from '../../core/models';
import { problemMessage } from '../../core/problem';
import { Icon } from '../../shared/icon';
import { LoadError } from '../../shared/load-error';

type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';

const STATE: Record<string, { label: string; tone: Tone }> = {
  up: { label: 'En ligne', tone: 'ok' },
  degraded: { label: 'Perturbé', tone: 'warn' },
  down: { label: 'Hors ligne', tone: 'bad' },
  unknown: { label: 'Pas encore vérifié', tone: 'muted' },
  noui: { label: "Sans interface web", tone: 'muted' },
};

const TLS: Record<string, { label: string; tone: Tone }> = {
  verified: { label: 'Vérifié', tone: 'ok' },
  untrusted: { label: 'Autorité inconnue de ce serveur', tone: 'info' },
  'name-mismatch': { label: 'Mauvais nom', tone: 'warn' },
  expired: { label: 'Expiré', tone: 'bad' },
  'traefik-default': { label: 'Certificat par défaut de Traefik', tone: 'bad' },
};

/**
 * Services : état de chaque service auto-hébergé (*.home.arpa), mesuré par l'API chaque minute. Les certificats de l'autorité
 * interne ne durent que 24 h : leur échéance est montrée en heures, en alerte sous 6 h (Traefik doit les renouveler avant).
 */
@Component({
  selector: 'app-services',
  imports: [MatTableModule, MatProgressBarModule, Icon, LoadError],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .loading { height: 3px; }
    .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 16px; }
    .summary .chip { font-size: 0.85rem; padding: 6px 12px; }
    .name { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text); text-decoration: none; }
    .name:hover { text-decoration: underline; }
    .name app-icon { --icon-size: 14px; color: var(--text-3); }
    .why { color: var(--text-2); font-size: 0.85rem; }
    .refresh { display: inline-flex; align-items: center; gap: 8px; }
    .refresh app-icon { --icon-size: 16px; }
    .head-actions { display: flex; align-items: center; gap: 12px; }
    .checked { color: var(--text-3); font-size: 0.8rem; }
    .cell-sub.soon { color: var(--warn); font-weight: 600; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Administration</p><h1>Services</h1>
          <p>Services auto-hébergés de la maison, vérifiés chaque minute par l'API : réponse, délai et certificat.</p></div>
        <div class="head-actions">
          @if (lastCheck(); as at) { <span class="checked">Vérifié à {{ at }}</span> }
          <button class="btn refresh" type="button" (click)="refresh()" [disabled]="busy()"><app-icon name="refresh" />Vérifier maintenant</button>
        </div>
      </div>

      @if (rows().length) {
        <p class="summary" role="status">
          <span class="chip" data-tone="ok">{{ count('up') }} en ligne</span>
          @if (count('degraded')) { <span class="chip" data-tone="warn">{{ count('degraded') }} perturbé(s)</span> }
          @if (count('down')) { <span class="chip" data-tone="bad">{{ count('down') }} hors ligne</span> }
          @if (expiringSoon()) { <span class="chip" data-tone="warn">{{ expiringSoon() }} certificat(s) expirent dans moins de 6 h</span> }
        </p>
      }

      <div class="panel">
        <div class="loading">@if (loading() || busy()) { <mat-progress-bar mode="indeterminate" aria-label="Vérification en cours" /> }</div>
        <div class="scroll-x">
          <table mat-table class="stack-800" [dataSource]="rows()" [trackBy]="trackByKey">
            <ng-container matColumnDef="service">
              <th mat-header-cell *matHeaderCellDef>Service</th>
              <td mat-cell *matCellDef="let s">
                @if (s.url) { <a class="name" [href]="s.url" target="_blank" rel="noopener noreferrer">{{ s.name }}<app-icon name="external" /></a> }
                @else { <span class="name">{{ s.name }}</span> }
                <span class="cell-sub">{{ s.portal ? 'Application de la maison' : 'Administration' }}</span>
              </td>
            </ng-container>
            <ng-container matColumnDef="state">
              <th mat-header-cell *matHeaderCellDef>État</th>
              <td mat-cell *matCellDef="let s" data-label="État">
                <span class="chip" [attr.data-tone]="state(s).tone">{{ state(s).label }}</span>
                @if (s.since && s.state !== 'noui') { <span class="cell-sub">depuis {{ since(s.since) }}</span> }
              </td>
            </ng-container>
            <ng-container matColumnDef="response">
              <th mat-header-cell *matHeaderCellDef>Réponse</th>
              <td mat-cell *matCellDef="let s" class="tnum" data-label="Réponse">
                @if (s.latencyMs != null) { {{ s.latencyMs }} ms } @else { — }
                @if (s.httpCode) { <span class="cell-sub">HTTP {{ s.httpCode }}</span> }
              </td>
            </ng-container>
            <ng-container matColumnDef="certificate">
              <th mat-header-cell *matHeaderCellDef>Certificat</th>
              <td mat-cell *matCellDef="let s" data-label="Certificat">
                @if (s.tls) { <span class="chip" [attr.data-tone]="tls(s).tone">{{ tls(s).label }}</span> } @else { — }
                @if (s.certNotAfter) { <span class="cell-sub" [class.soon]="hoursLeft(s) < 6">{{ expiry(s) }}</span> }
              </td>
            </ng-container>
            <ng-container matColumnDef="why">
              <th mat-header-cell *matHeaderCellDef>Détail</th>
              <td mat-cell *matCellDef="let s" class="why" data-label="Détail">{{ s.error ?? '' }}</td>
            </ng-container>
            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>
        </div>
        @if (!loading() && failed() && rows().length === 0) {
          <app-load-error message="L'état des services n'a pas pu être lu." (retry)="load()" />
        }
      </div>
    </div>
  `,
})
export class Services {
  private readonly admin = inject(AdminService);
  private readonly snack = inject(MatSnackBar);

  protected readonly columns = ['service', 'state', 'response', 'certificate', 'why'];
  protected readonly rows = signal<ServiceProbe[]>([]);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly failed = signal(false);
  protected readonly trackByKey = (_: number, s: ServiceProbe) => s.key;

  protected readonly lastCheck = computed(() => {
    const at = this.rows().map(s => s.checkedAt).filter((d): d is string => !!d).sort().at(-1);
    return at ? new Date(at).toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : null;
  });
  protected readonly expiringSoon = computed(() => this.rows().filter(s => s.certNotAfter && this.hoursLeft(s) < 6).length);

  constructor() {
    this.load();
    // L'API sonde chaque minute ; la page relit son état toutes les 30 s.
    interval(30_000).pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe(() => this.load(true));
  }

  protected count(state: string): number { return this.rows().filter(s => s.state === state).length; }
  protected state(s: ServiceProbe) { return STATE[s.state] ?? STATE['unknown']!; }
  protected tls(s: ServiceProbe) { return TLS[s.tls ?? ''] ?? { label: s.tls ?? '', tone: 'muted' as Tone }; }

  protected hoursLeft(s: ServiceProbe): number {
    return s.certNotAfter ? (new Date(s.certNotAfter).getTime() - Date.now()) / 3_600_000 : Infinity;
  }

  protected expiry(s: ServiceProbe): string {
    const h = this.hoursLeft(s);
    if (h <= 0) return 'expiré';
    if (h < 48) return `expire dans ${Math.floor(h)} h ${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    return `expire dans ${Math.floor(h / 24)} jours`;
  }

  protected since(iso: string): string {
    const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
    return min < 1 ? "moins d'une minute" : min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.floor(min / 60)} h` : `${Math.floor(min / 1440)} jours`;
  }

  load(quiet = false): void {
    if (!quiet) this.loading.set(true);
    this.admin.services().subscribe({
      next: rows => { this.rows.set(rows); this.loading.set(false); this.failed.set(false); },
      error: e => { this.loading.set(false); this.failed.set(true); if (!quiet) this.snack.open(problemMessage(e, 'État des services indisponible.'), 'OK', { duration: 5000 }); },
    });
  }

  protected refresh(): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.admin.refreshServices().subscribe({
      next: rows => { this.rows.set(rows); this.busy.set(false); this.snack.open('Services vérifiés', 'OK', { duration: 2000 }); },
      error: e => { this.busy.set(false); this.snack.open(problemMessage(e, 'Vérification impossible.'), 'OK', { duration: 5000 }); },
    });
  }
}
