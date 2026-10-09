import { Routes } from '@angular/router';
import { adminGuard, staffGuard } from './core/guards';

export const routes: Routes = [
  { path: 'login', title: 'Connexion · Divertiflix', loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  {
    path: '',
    canActivate: [staffGuard],
    loadComponent: () => import('./pages/layout/layout').then(m => m.Layout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Tableau de bord · Divertiflix', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'catalog', title: 'Catalogue · Divertiflix', loadComponent: () => import('./pages/catalog/catalog').then(m => m.Catalog) },
      { path: 'requests', title: 'Demandes · Divertiflix', loadComponent: () => import('./pages/requests/requests').then(m => m.Requests) },
      { path: 'tickets', title: "Billets d'aide · Divertiflix", loadComponent: () => import('./pages/tickets/tickets').then(m => m.Tickets) },
      { path: 'users', title: 'Utilisateurs · Divertiflix', canActivate: [adminGuard], loadComponent: () => import('./pages/users/users').then(m => m.Users) },
    ],
  },
  { path: '**', redirectTo: '' },
];
