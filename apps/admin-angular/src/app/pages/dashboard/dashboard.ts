import { DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { map } from 'rxjs';
import { LiveService } from '../../core/live.service';
import { TitlesService } from '../../core/titles.service';

@Component({
  selector: 'app-dashboard',
  imports: [MatCardModule, MatIconModule, DatePipe],
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .big { font-size: 2.4rem; margin: 0; }
    li { display: flex; justify-content: space-between; padding: .2rem 0; }
    ul { list-style: none; padding: 0; margin: 0; }
    .live-status { display: flex; align-items: center; gap: .4rem; font-size: .9rem; }
    .dot { width: .6rem; height: .6rem; border-radius: 50%; background: #c62828; }
    .dot.on { background: #2e7d32; }
    .events { list-style: none; padding: 0; margin: 0; max-height: 220px; overflow-y: auto; }
    .events li { flex-direction: column; align-items: flex-start; border-bottom: 1px solid #0000001f; padding: .4rem 0; }
    .events time { font-size: .75rem; opacity: .7; }
    .empty { opacity: .7; }
  `,
  template: `
    <h1>Tableau de bord</h1>
    <div class="grid">
      <mat-card><mat-card-header><mat-card-title>Titres</mat-card-title></mat-card-header>
        <mat-card-content><p class="big">{{ stats()?.total ?? '…' }}</p></mat-card-content></mat-card>
      <mat-card><mat-card-header><mat-card-title>Films</mat-card-title></mat-card-header>
        <mat-card-content><p class="big">{{ stats()?.movies ?? '…' }}</p></mat-card-content></mat-card>
      <mat-card><mat-card-header><mat-card-title>Séries</mat-card-title></mat-card-header>
        <mat-card-content><p class="big">{{ stats()?.series ?? '…' }}</p></mat-card-content></mat-card>
      <mat-card><mat-card-header><mat-card-title>Livres audio</mat-card-title></mat-card-header>
        <mat-card-content><p class="big">{{ stats()?.audiobooks ?? '…' }}</p></mat-card-content></mat-card>
    </div>
    <mat-card>
      <mat-card-header><mat-card-title>Titres par genre</mat-card-title></mat-card-header>
      <mat-card-content>
        <ul>@for (g of stats()?.byGenre ?? []; track g[0]) { <li><span>{{ g[0] }}</span><strong>{{ g[1] }}</strong></li> }</ul>
      </mat-card-content>
    </mat-card>
    <mat-card style="margin-top:1rem">
      <mat-card-header>
        <mat-card-title>Supervision en direct</mat-card-title>
        <span class="live-status"><span class="dot" [class.on]="live.connected()"></span>{{ live.connected() ? 'Connecté' : 'Déconnecté' }}</span>
      </mat-card-header>
      <mat-card-content>
        @if (live.events().length === 0) {
          <p class="empty">Rien pour l'instant. Un nouveau titre, une synchro AD/Audiobookshelf, ou un message
          d'un capteur ESP32 (simuler avec <code>mosquitto_pub -h localhost -t divertiflix/capteurs/temp1 -m '{{ '{' }}"temp":21.5{{ '}' }}'</code>) apparaîtra ici.</p>
        } @else {
          <ul class="events">
            @for (e of live.events(); track e.at) {
              <li><time>{{ e.at | date: 'HH:mm:ss' }}</time><span>{{ e.text }}</span></li>
            }
          </ul>
        }
      </mat-card-content>
    </mat-card>
  `,
})
export class Dashboard {
  protected readonly live = inject(LiveService);

  readonly stats = toSignal(
    inject(TitlesService).list({ pageSize: 100 }).pipe(
      map(p => {
        const byGenre = new Map<string, number>();
        for (const t of p.items) byGenre.set(t.genre, (byGenre.get(t.genre) ?? 0) + 1);
        return {
          total: p.total,
          movies: p.items.filter(t => t.kind === 'Movie').length,
          series: p.items.filter(t => t.kind === 'Series').length,
          audiobooks: p.items.filter(t => t.kind === 'Audiobook').length,
          byGenre: [...byGenre.entries()].sort((a, b) => b[1] - a[1]),
        };
      }),
    ),
  );

  constructor() {
    this.live.connect();
  }
}
