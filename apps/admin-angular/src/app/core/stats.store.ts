import { inject, Injectable, signal } from '@angular/core';
import { AdminService } from './admin.service';
import type { Stats } from './models';

/** Compteurs d'exploitation partagés : la barre latérale (pastilles) et le tableau de bord lisent la même mesure. */
@Injectable({ providedIn: 'root' })
export class StatsStore {
  private readonly admin = inject(AdminService);
  readonly stats = signal<Stats | null>(null);
  readonly failed = signal(false);

  refresh(): void {
    this.admin.stats().subscribe({
      next: s => { this.stats.set(s); this.failed.set(false); },
      // On garde les derniers chiffres connus : un raté réseau ne doit pas tout remettre à zéro.
      error: () => this.failed.set(true),
    });
  }
}
