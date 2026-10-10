import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { TitleDialog } from './title-dialog';

function render() {
  TestBed.configureTestingModule({ providers: [{ provide: MAT_DIALOG_DATA, useValue: null }, { provide: MatDialogRef, useValue: { close: vi.fn() } }] });
  const fixture = TestBed.createComponent(TitleDialog);
  fixture.detectChanges();
  return fixture;
}

describe('TitleDialog', () => {
  it('explique chaque champ invalide au lieu de griser « Enregistrer » sans rien dire', async () => {
    const fixture = render();
    fixture.componentInstance.form.patchValue({ year: 0, durationMinutes: 7000, rating: 11 });
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const errors = [...(fixture.nativeElement as HTMLElement).querySelectorAll('mat-error')].map(e => e.textContent!.trim());
    expect(errors).toEqual([
      'Le nom est obligatoire.', 'Le genre est obligatoire.', 'Une année entre 1 et 2200.', 'Une durée entre 0 et 6000 minutes.', 'Une note entre 0 et 10.',
    ]);
    const save = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(b => b.textContent!.includes('Enregistrer'))!;
    expect(save.disabled).toBe(true);
  });

  it('accepte une année ancienne : les livres du catalogue datent de 1759 ou 1818', async () => {
    const fixture = render();
    fixture.componentInstance.form.patchValue({ name: 'Candide', genre: 'Satire', year: 1759 });
    expect(fixture.componentInstance.form.controls.year.valid).toBe(true);
    fixture.componentInstance.form.patchValue({ year: 2201 });
    expect(fixture.componentInstance.form.controls.year.valid).toBe(false);
  });

  it('un formulaire valide ne montre aucune erreur', async () => {
    const fixture = render();
    fixture.componentInstance.form.patchValue({ name: 'Nosferatu', genre: 'Horreur' });
    fixture.componentInstance.form.markAllAsTouched();
    fixture.detectChanges();
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).querySelectorAll('mat-error')).toHaveLength(0);
  });
});
