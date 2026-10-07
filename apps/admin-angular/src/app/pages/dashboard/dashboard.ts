import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { map } from 'rxjs';
import { TitlesService } from '../../core/titles.service';

@Component({
  selector: 'app-dashboard',
  imports: [MatCardModule],
  styles: `
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .big { font-size: 2.4rem; margin: 0; }
    li { display: flex; justify-content: space-between; padding: .2rem 0; }
    ul { list-style: none; padding: 0; margin: 0; }
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
    </div>
    <mat-card>
      <mat-card-header><mat-card-title>Titres par genre</mat-card-title></mat-card-header>
      <mat-card-content>
        <ul>@for (g of stats()?.byGenre ?? []; track g[0]) { <li><span>{{ g[0] }}</span><strong>{{ g[1] }}</strong></li> }</ul>
      </mat-card-content>
    </mat-card>
    <mat-card style="margin-top:1rem">
      <mat-card-header><mat-card-title>Supervision en direct</mat-card-title></mat-card-header>
      <mat-card-content>Capteurs ESP32 et notifications : à venir (étape 4, SignalR).</mat-card-content>
    </mat-card>
  `,
})
export class Dashboard {
  // pageSize max de l'API = 100 : suffisant tant que le catalogue reste petit.
  readonly stats = toSignal(
    inject(TitlesService).list({ pageSize: 100 }).pipe(
      map(p => {
        const byGenre = new Map<string, number>();
        for (const t of p.items) byGenre.set(t.genre, (byGenre.get(t.genre) ?? 0) + 1);
        return {
          total: p.total,
          movies: p.items.filter(t => t.kind === 'Movie').length,
          series: p.items.filter(t => t.kind === 'Series').length,
          byGenre: [...byGenre.entries()].sort((a, b) => b[1] - a[1]),
        };
      }),
    ),
  );
}
