import { HttpErrorResponse } from '@angular/common/http';
import { problemMessage } from './problem';

const err = (status: number, error: unknown) => new HttpErrorResponse({ status, error });

describe('problemMessage', () => {
  it('lit le detail d\'un problem+json', () => {
    expect(problemMessage(err(409, { detail: 'Il doit rester au moins un administrateur actif.' }))).toBe('Il doit rester au moins un administrateur actif.');
  });
  it('accepte l\'ancien format { error }', () => {
    expect(problemMessage(err(400, { error: 'Titre invalide.' }))).toBe('Titre invalide.');
  });
  it('remonte la première erreur de validation', () => {
    expect(problemMessage(err(400, { errors: { Name: ['Le nom est obligatoire.'] } }))).toBe('Le nom est obligatoire.');
  });
  it('explique les cas courants sans corps lisible', () => {
    expect(problemMessage(err(0, null))).toMatch(/injoignable/);
    expect(problemMessage(err(403, null))).toMatch(/rôle/);
    expect(problemMessage(err(429, null))).toMatch(/Trop de requêtes/);
    expect(problemMessage(err(500, null), 'Repli.')).toBe('Repli.');
    expect(problemMessage(new Error('x'), 'Repli.')).toBe('Repli.');
  });
});
