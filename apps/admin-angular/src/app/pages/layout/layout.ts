import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatSidenavModule, MatListModule, MatButtonModule, MatIconModule],
  styles: `
    mat-sidenav-container { height: calc(100vh - 64px); }
    mat-sidenav { width: 220px; }
    .spacer { flex: 1; }
    main { padding: 1.5rem; max-width: 1200px; }
    .who { margin-right: 1rem; opacity: .8; }
  `,
  template: `
    <mat-toolbar>
      <strong>Divertiflix</strong>&nbsp;Back-office
      <span class="spacer"></span>
      <span class="who">{{ auth.user()?.email }} · {{ auth.user()?.role }}</span>
      <button mat-button (click)="auth.logout()">Déconnexion</button>
    </mat-toolbar>
    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/dashboard" routerLinkActive="active">Tableau de bord</a>
          <a mat-list-item routerLink="/catalog" routerLinkActive="active">Catalogue</a>
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content><main><router-outlet /></main></mat-sidenav-content>
    </mat-sidenav-container>
  `,
})
export class Layout {
  protected readonly auth = inject(AuthService);
}
