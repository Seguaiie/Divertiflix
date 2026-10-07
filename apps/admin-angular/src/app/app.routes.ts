import { Routes } from '@angular/router';
import { staffGuard } from './core/guards';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.Login) },
  {
    path: '',
    canActivate: [staffGuard],
    loadComponent: () => import('./pages/layout/layout').then(m => m.Layout),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) },
      { path: 'catalog', loadComponent: () => import('./pages/catalog/catalog').then(m => m.Catalog) },
    ],
  },
  { path: '**', redirectTo: '' },
];
