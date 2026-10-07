import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Réservé au personnel (Admin ou Support) : les abonnés n'ont rien à faire ici. */
export const staffGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isStaff() ? true : inject(Router).createUrlTree(['/login']);
};
