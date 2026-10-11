import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Réservé au personnel (Admin ou Support) : les abonnés n'ont rien à faire ici. */
export const staffGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isStaff() ? true : inject(Router).createUrlTree(['/login']);
};

/** La page de connexion n'a de sens que sans session du personnel : une session déjà ouverte (autre onglet, rechargement) mène au tableau de bord. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isStaff() ? inject(Router).createUrlTree(['/dashboard']) : true;
};

/** Pages réservées aux administrateurs (comptes) : le rôle Support est renvoyé au tableau de bord. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAdmin() ? true : inject(Router).createUrlTree(['/dashboard']);
};
