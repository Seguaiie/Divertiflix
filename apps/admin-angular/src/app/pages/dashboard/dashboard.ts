import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, interval, of, startWith, switchMap } from 'rxjs';
import { AdminService } from '../../core/admin.service';
import type { SystemStatus } from '../../core/models';
import { LiveService, type LiveKind } from '../../core/live.service';
import { StatsStore } from '../../core/stats.store';
import { Icon } from '../../shared/icon';
import type { IconName } from '../../shared/icons';

const SERVICE_LABEL: Record<string, string> = { api: 'Application', database: 'Base de données', sensors: 'Capteurs (MQTT)' };
const EVENT_ICON: Record<LiveKind, IconName> = {
  titleAdded: 'film', requestCreated: 'requests', ticketCreated: 'tickets', ticketReplied: 'tickets',
  directorySynced: 'users', audiobookshelfSynced: 'headphones', sensorMessage: 'radio',
};

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, DecimalPipe, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 14px; margin-bottom: 20px; }
    .kpi { display: grid; gap: 4px; padding: 18px 20px; border-radius: 14px; background: var(--bg-1); border: 1px solid var(--line); color: inherit; text-decoration: none; transition: border-color 160ms var(--ease), background 160ms var(--ease), transform 160ms var(--ease); }
    a.kpi:hover { border-color: var(--line-strong); background: var(--bg-2); transform: translateY(-1px); }
    .kpi .label { display: flex; align-items: center; gap: 8px; color: var(--text-3); font-size: 0.75rem; letter-spacing: 0.04em; }
    .kpi .value { font-family: var(--font-display); font-weight: 700; font-size: 2.3rem; line-height: 1.05; letter-spacing: -0.04em; }
    .kpi .hint { color: var(--text-3); font-size: 0.75rem; }
    .kpi[data-alert='true'] .value { color: var(--accent-hi); }
    .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; margin-bottom: 16px; }
    .split { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .split span { padding: 4px 12px; border-radius: 999px; background: var(--bg-3); color: var(--text-2); font-size: 0.8125rem; }
    .split b { color: var(--text); font-weight: 600; margin-right: 4px; }
    .bars { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
    .bars li { display: grid; grid-template-columns: 120px 1fr 32px; gap: 12px; align-items: center; font-size: 0.8125rem; }
    .bar { height: 6px; border-radius: 3px; background: var(--bg-3); overflow: hidden; }
    .bar i { display: block; height: 100%; border-radius: 3px; background: var(--brand-gradient-vivid); }
    .svc { list-style: none; margin: 0; padding: 0; }
    .svc li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--line); }
    .svc li:last-child { border: 0; }
    .feed { list-style: none; margin: 0; padding: 0; max-height: 340px; overflow-y: auto; }
    .feed li { display: grid; grid-template-columns: 20px 1fr auto; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
    .feed li:last-child { border: 0; }
    .feed app-icon { color: var(--accent); }
    .feed time { color: var(--text-3); font-size: 0.75rem; }
  `,
  template: `
    <div class="page">
      <div class="page-head">
        <div><p class="eyebrow">Vue d'ensemble</p><h1>Tableau de bord</h1></div>
      </div>

      @if (store.failed() && !s()) { <p class="error-text" role="alert">Impossible de charger les statistiques.</p> }

      <div class="kpis">
        <a class="kpi" routerLink="/requests" [attr.data-alert]="(s()?.requestsPending ?? 0) > 0">
          <span class="label"><app-icon name="requests" />Demandes en attente</span>
          <span class="value tnum">{{ s() ? s()!.requestsPending : '·' }}</span>
          <span class="hint">{{ s()?.requestsInProgress ?? 0 }} en cours de traitement</span>
        </a>
        <a class="kpi" routerLink="/tickets" [attr.data-alert]="(s()?.ticketsOpen ?? 0) > 0">
          <span class="label"><app-icon name="tickets" />Billets non résolus</span>
          <span class="value tnum">{{ s() ? s()!.ticketsOpen : '·' }}</span>
          <span class="hint">Ouverts ou en cours</span>
        </a>
        <div class="kpi">
          <span class="label"><app-icon name="play" />Lectures sur 24 h</span>
          <span class="value tnum">{{ s() ? (s()!.plays24h | number) : '·' }}</span>
          <span class="hint">{{ s()?.activeProfiles7d ?? 0 }} profils actifs sur 7 jours</span>
        </div>
        <a class="kpi" routerLink="/catalog">
          <span class="label"><app-icon name="catalog" />Titres lisibles</span>
          <span class="value tnum">{{ s() ? s()!.playable : '·' }}</span>
          <span class="hint">sur {{ s()?.titles ?? 0 }} au catalogue</span>
        </a>
        <a class="kpi" routerLink="/users">
          <span class="label"><app-icon name="users" />Comptes actifs</span>
          <span class="value tnum">{{ s() ? s()!.activeUsers : '·' }}</span>
          <span class="hint">{{ s()?.users ?? 0 }} comptes, dont {{ s()?.staff ?? 0 }} du personnel</span>
        </a>
      </div>

      <div class="cols">
        <section class="panel" aria-labelledby="h-cat">
          <div class="panel-head"><h2 id="h-cat">Catalogue</h2></div>
          <div class="panel-body">
            <div class="split">
              <span><b class="tnum">{{ s()?.movies ?? 0 }}</b>films</span>
              <span><b class="tnum">{{ s()?.series ?? 0 }}</b>séries</span>
              <span><b class="tnum">{{ s()?.audiobooks ?? 0 }}</b>livres audio</span>
            </div>
            <ul class="bars" aria-label="Titres par genre">
              @for (g of genres(); track g.genre) {
                <li><span>{{ g.genre }}</span><span class="bar" aria-hidden="true"><i [style.width.%]="g.pct"></i></span><b class="tnum">{{ g.count }}</b></li>
              } @empty { <li class="note">Aucun titre pour l'instant.</li> }
            </ul>
          </div>
        </section>

        <section class="panel" aria-labelledby="h-svc">
          <div class="panel-head"><h2 id="h-svc">Services</h2>
            @if (status()) { <span class="chip" [attr.data-tone]="status()!.state === 'up' ? 'ok' : status()!.state === 'degraded' ? 'warn' : 'bad'">{{ stateLabel(status()!.state) }}</span> }
          </div>
          <div class="panel-body">
            @if (status(); as st) {
              <ul class="svc">
                @for (v of st.services; track v.id) {
                  <li><span>{{ serviceLabel(v.id) }}@if (v.latencyMs !== null) { <small class="cell-sub tnum">{{ v.latencyMs }} ms</small> }</span>
                    <span class="chip" [attr.data-tone]="v.state === 'up' ? 'ok' : 'bad'">{{ v.state === 'up' ? 'Opérationnel' : 'Hors service' }}</span></li>
                }
              </ul>
              <p class="note">Version {{ st.version }}, mesuré à {{ st.at | date: 'HH:mm:ss' }}.</p>
            } @else { <p class="note">Mesure en cours.</p> }
          </div>
        </section>
      </div>

      <section class="panel" aria-labelledby="h-live">
        <div class="panel-head"><h2 id="h-live">En direct</h2><span class="note">{{ live.connected() ? 'Connecté' : 'Déconnecté' }}</span></div>
        <div class="panel-body">
          @if (live.events().length === 0) {
            <p class="note">Rien pour l'instant. Une demande, un billet, une synchronisation ou un message d'un capteur apparaîtra ici.
              Pour simuler un capteur : <code>mosquitto_pub -h localhost -t divertiflix/capteurs/temp1 -m '{{ '{' }}"temp":21.5{{ '}' }}'</code></p>
          } @else {
            <ul class="feed" aria-live="polite">
              @for (e of live.events(); track e.id) {
                <li><app-icon [name]="icon(e.kind)" /><span>{{ e.text }}</span><time [attr.datetime]="e.at.toISOString()">{{ e.at | date: 'HH:mm:ss' }}</time></li>
              }
            </ul>
          }
        </div>
      </section>
    </div>
  `,
})
export class Dashboard {
  protected readonly live = inject(LiveService);
  protected readonly store = inject(StatsStore);
  private readonly admin = inject(AdminService);

  protected readonly s = this.store.stats;
  protected readonly status = signal<SystemStatus | null>(null);
  protected readonly genres = computed(() => {
    const list = this.s()?.byGenre ?? [];
    const max = Math.max(1, ...list.map(g => g.count));
    return list.map(g => ({ ...g, pct: Math.round((g.count / max) * 100) }));
  });

  constructor() {
    this.store.refresh();
    // État des services : mesuré toutes les 30 s tant que la page est ouverte.
    interval(30_000).pipe(startWith(0), switchMap(() => this.admin.status().pipe(catchError(() => of(null)))), takeUntilDestroyed())
      .subscribe(v => { if (v) this.status.set(v); });
  }

  protected icon = (k: LiveKind): IconName => EVENT_ICON[k];
  protected serviceLabel = (id: string) => SERVICE_LABEL[id] ?? id;
  protected stateLabel = (s: string) => (s === 'up' ? 'Tout fonctionne' : s === 'degraded' ? 'Service dégradé' : 'Panne');
}
