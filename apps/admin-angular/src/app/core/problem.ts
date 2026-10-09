import { HttpErrorResponse } from '@angular/common/http';

/** Message lisible d'une erreur HTTP : problem+json (detail), ancien format { error }, erreurs de validation, ou repli. */
export function problemMessage(err: unknown, fallback = 'Une erreur est survenue. Réessayez.'): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Serveur injoignable. Vérifiez la connexion.';
  const e = err.error as { error?: string; detail?: string; errors?: Record<string, string[]> } | null;
  if (e?.error) return e.error;
  if (e?.detail) return e.detail;
  const first = e?.errors ? Object.values(e.errors).flat()[0] : undefined;
  if (first) return first;
  if (err.status === 403) return "Votre rôle ne permet pas cette action.";
  if (err.status === 429) return 'Trop de requêtes. Patientez une minute.';
  return fallback;
}
