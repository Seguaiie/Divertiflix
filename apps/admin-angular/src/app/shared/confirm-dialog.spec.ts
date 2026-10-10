import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA } from '@angular/material/dialog';
import { ConfirmDialog } from './confirm-dialog';

// Le focus lui-même est vérifié dans un vrai navigateur (jsdom ne mesure aucune mise en page, le piège à focus n'y trouve rien) :
// ici on contrôle qu'une action irréversible désigne « Annuler » comme cible initiale.
function render(danger: boolean): HTMLElement {
  TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: { title: 'Supprimer ?', message: 'Définitif.', confirm: 'Supprimer', danger } }] });
  const fixture = TestBed.createComponent(ConfirmDialog);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const initial = (el: HTMLElement) => el.querySelector('[cdkfocusinitial]')?.textContent?.trim();

describe('ConfirmDialog', () => {
  it('une action irréversible met le focus initial sur « Annuler » : un Entrée de trop ne supprime rien', () => {
    expect(initial(render(true))).toBe('Annuler');
  });

  it('une confirmation ordinaire met le focus initial sur l\'action', () => {
    expect(initial(render(false))).toBe('Supprimer');
  });
});
