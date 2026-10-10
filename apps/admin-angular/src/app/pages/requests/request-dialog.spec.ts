import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import type { AdminRequest, AdminTitle } from '../../core/models';
import { RequestDialog, type RequestActionData } from './request-dialog';

const request = { id: 'r1', name: 'Nosferatu', kind: 'Movie', year: 1922, status: 'Approved' } as AdminRequest;
const title = (id: string, name: string, isPlayable: boolean) => ({ id, name, year: 1922, isPlayable } as AdminTitle);

function setup(action: RequestActionData['action']) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(), provideHttpClientTesting(),
      { provide: MAT_DIALOG_DATA, useValue: { request, action } satisfies RequestActionData },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(RequestDialog);
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const button = (label: string) => [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === label) as HTMLButtonElement;
  return { fixture, ctl: TestBed.inject(HttpTestingController), close, button, cmp: fixture.componentInstance as unknown as { picked: { set(t: AdminTitle | null): void; (): AdminTitle | null }; query: { setValue(v: string): void }; reason: { setValue(v: string): void } } };
}

describe('RequestDialog', () => {
  afterEach(() => vi.useRealTimers());

  it('« disponible » : seuls les titres lisibles sont proposés, et « Confirmer » attend un choix, que retaper annule', async () => {
    const { fixture, ctl, close, button, cmp } = setup('Available');
    await vi.advanceTimersByTimeAsync(250);
    ctl.expectOne(r => r.url === '/api/admin/titles' && r.params.get('q') === 'Nosferatu')
      .flush({ items: [title('a', 'Nosferatu', true), title('b', 'Nosferatu (sans source)', false)], total: 2, page: 1, pageSize: 12 });
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { options(): AdminTitle[] }).options().map(t => t.id)).toEqual(['a']);

    expect(button('Confirmer').disabled).toBe(true);
    cmp.picked.set(title('a', 'Nosferatu', true));
    fixture.detectChanges();
    expect(button('Confirmer').disabled).toBe(false);

    cmp.query.setValue('Autre chose'); // on retape : le choix précédent n'est plus celui qui est affiché
    fixture.detectChanges();
    expect(cmp.picked()).toBeNull();
    expect(button('Confirmer').disabled).toBe(true);

    cmp.picked.set(title('a', 'Nosferatu', true));
    fixture.detectChanges();
    button('Confirmer').click();
    expect(close).toHaveBeenCalledWith({ titleId: 'a' });
  });

  it('refus : la raison est transmise sans espaces superflus, ou omise quand elle est vide', () => {
    const { fixture, close, button, cmp } = setup('Declined');
    cmp.reason.setValue('  Déjà au catalogue.  ');
    button('Refuser').click();
    expect(close).toHaveBeenLastCalledWith({ reason: 'Déjà au catalogue.' });

    cmp.reason.setValue('   ');
    fixture.detectChanges();
    button('Refuser').click();
    expect(close).toHaveBeenLastCalledWith({ reason: undefined });
  });
});
