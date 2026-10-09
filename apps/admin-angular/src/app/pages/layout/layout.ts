import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatSidenavModule } from '@angular/material/sidenav';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, interval, map } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { LiveService } from '../../core/live.service';
import { ROLE_LABEL } from '../../core/format';
import { StatsStore } from '../../core/stats.store';
import { Icon } from '../../shared/icon';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatSidenavModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: block; }
    .skip { position: absolute; left: 12px; top: -48px; z-index: 100; background: var(--text); color: var(--bg-0); padding: 8px 14px; border-radius: 8px; font-weight: 600; text-decoration: none; transition: top 140ms; }
    .skip:focus { top: 10px; }
    .topbar { position: sticky; top: 0; z-index: 20; height: 56px; display: flex; align-items: center; gap: 14px; padding: 0 clamp(12px, 2vw, 24px); background: rgb(var(--ink) / 0.86); backdrop-filter: blur(14px); border-bottom: 1px solid var(--line); }
    .brand { display: flex; align-items: center; gap: 12px; color: var(--text); text-decoration: none; }
    .brand img { display: block; height: 28px; width: auto; }
    .brand span { font-size: 0.6875rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent-hi); font-weight: 600; padding: 3px 8px; border: 1px solid color-mix(in oklab, var(--accent) 45%, transparent); border-radius: 999px; }
    .grow { flex: 1; }
    .live { display: inline-flex; align-items: center; gap: 8px; color: var(--text-3); font-size: 0.75rem; }
    .live i { width: 8px; height: 8px; border-radius: 50%; background: var(--danger); box-shadow: 0 0 0 3px color-mix(in oklab, var(--danger) 18%, transparent); }
    .live[data-on='true'] i { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ok) 18%, transparent); }
    .who { text-align: right; line-height: 1.2; }
    .who strong { display: block; font-size: 0.8125rem; font-weight: 500; }
    .who small { color: var(--text-3); font-size: 0.6875rem; }
    .btn { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border-radius: 8px; border: 1px solid transparent; background: none; color: var(--text-2); font: inherit; font-size: 0.8125rem; cursor: pointer; text-decoration: none; transition: background 140ms, color 140ms; }
    .btn:hover { background: var(--bg-3); color: var(--text); }
    .menu { display: none; }
    mat-sidenav-container { min-height: calc(100vh - 56px); background: transparent; }
    mat-sidenav { width: 236px; background: var(--bg-1); border-right: 1px solid var(--line); border-radius: 0; }
    nav { display: flex; flex-direction: column; gap: 2px; padding: 16px 12px; height: 100%; }
    nav a.item { position: relative; display: flex; align-items: center; gap: 12px; height: 40px; padding: 0 12px; border-radius: 8px; color: var(--text-2); text-decoration: none; font-weight: 500; transition: background 140ms, color 140ms; }
    nav a.item:hover { background: var(--bg-3); color: var(--text); }
    nav a.item.active { background: var(--bg-3); color: var(--text); }
    nav a.item.active::before { content: ''; position: absolute; left: -12px; top: 9px; bottom: 9px; width: 3px; border-radius: 0 3px 3px 0; background: var(--brand-gradient-vivid); }
    nav a.item.active app-icon { color: var(--accent); }
    .count { margin-left: auto; min-width: 22px; height: 20px; padding: 0 7px; display: grid; place-items: center; border-radius: 999px; background: var(--brand-gradient); color: var(--on-brand); font-size: 0.6875rem; font-weight: 700; }
    .sep { flex: 1; }
    .foot { border-top: 1px solid var(--line); padding-top: 12px; margin-top: 8px; }
    main { outline: none; }
    @media (max-width: 959px) {
      .menu { display: inline-flex; }
      .who, .lbl, .brand span { display: none; }
      .brand img { height: 22px; }
      .topbar { gap: 8px; }
    }
  `,
  template: `
    <a class="skip" href="#main">Aller au contenu</a>
    <header class="topbar">
      <button class="btn menu" type="button" (click)="menuOpen.set(!menuOpen())" aria-label="Menu de navigation" [attr.aria-expanded]="menuOpen()"><app-icon name="menu" /></button>
      <a class="brand" routerLink="/dashboard" aria-label="Divertiflix, tableau de bord"><img src="brand/lockup.svg" alt="Divertiflix" width="248" height="28" /><span>Back-office</span></a>
      <span class="grow"></span>
      <span class="live" [attr.data-on]="live.connected()" role="status"><i></i><span class="lbl">{{ live.connected() ? 'En direct' : 'Hors ligne' }}</span></span>
      <div class="who"><strong>{{ auth.user()?.email }}</strong><small>{{ role() }}</small></div>
      <button class="btn" type="button" (click)="auth.logout()" aria-label="Déconnexion"><app-icon name="logout" /><span class="lbl">Déconnexion</span></button>
    </header>
    <mat-sidenav-container>
      <mat-sidenav [mode]="narrow() ? 'over' : 'side'" [opened]="!narrow() || menuOpen()" (closedStart)="menuOpen.set(false)" [fixedInViewport]="narrow()" [fixedTopGap]="56">
        <nav aria-label="Navigation principale">
          <a class="item" routerLink="/dashboard" routerLinkActive="active" ariaCurrentWhenActive="page"><app-icon name="dashboard" />Tableau de bord</a>
          <a class="item" routerLink="/catalog" routerLinkActive="active" ariaCurrentWhenActive="page"><app-icon name="catalog" />Catalogue</a>
          <a class="item" routerLink="/requests" routerLinkActive="active" ariaCurrentWhenActive="page"><app-icon name="requests" />Demandes
            @if ((store.stats()?.requestsPending ?? 0) > 0) { <span class="count tnum" [attr.aria-label]="store.stats()!.requestsPending + ' en attente'">{{ store.stats()!.requestsPending }}</span> }</a>
          <a class="item" routerLink="/tickets" routerLinkActive="active" ariaCurrentWhenActive="page"><app-icon name="tickets" />Billets d'aide
            @if ((store.stats()?.ticketsOpen ?? 0) > 0) { <span class="count tnum" [attr.aria-label]="store.stats()!.ticketsOpen + ' ouverts'">{{ store.stats()!.ticketsOpen }}</span> }</a>
          @if (auth.isAdmin()) {
            <a class="item" routerLink="/users" routerLinkActive="active" ariaCurrentWhenActive="page"><app-icon name="users" />Utilisateurs</a>
          }
          <span class="sep"></span>
          <div class="foot"><a class="item" href="/"><app-icon name="external" />Ouvrir le portail</a></div>
        </nav>
      </mat-sidenav>
      <mat-sidenav-content><main id="main" tabindex="-1"><router-outlet /></main></mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class Layout {
  protected readonly auth = inject(AuthService);
  protected readonly live = inject(LiveService);
  protected readonly store = inject(StatsStore);
  private readonly router = inject(Router);

  protected readonly menuOpen = signal(false);
  protected readonly narrow = toSignal(inject(BreakpointObserver).observe('(max-width: 959px)').pipe(map(r => r.matches)), { initialValue: false });
  protected readonly role = () => ROLE_LABEL[this.auth.user()?.role ?? 'Subscriber'];

  constructor() {
    this.live.start();
    inject(DestroyRef).onDestroy(() => this.live.stop());

    // Les pastilles de la barre latérale suivent les évènements en direct ; un rafraîchissement lent rattrape un évènement manqué.
    effect(() => { this.live.tick(); untracked(() => this.store.refresh()); });
    interval(60_000).pipe(takeUntilDestroyed()).subscribe(() => this.store.refresh());

    // Après chaque navigation : menu refermé (mobile), focus sur le contenu pour les lecteurs d'écran.
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe(() => {
      this.menuOpen.set(false);
      document.getElementById('main')?.focus({ preventScroll: true });
    });
  }
}
