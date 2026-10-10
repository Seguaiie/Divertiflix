import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import type { AdminTicket } from '../../core/models';
import { Tickets } from './tickets';

const ticket = (over: Partial<AdminTicket['ticket']> = {}): AdminTicket => ({
  ticket: { id: 't1', subject: 'Sous-titres décalés', category: 'Playback', status: 'Open', createdAt: '2026-10-09T12:00:00Z', updatedAt: '2026-10-09T12:00:00Z', ...over },
  requester: 'camille@test.com', messages: 1,
});

async function setup() {
  localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Support' } }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(Tickets);
  const ctl = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  ctl.expectOne('/api/admin/tickets').flush([ticket()]);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
}

describe('Tickets', () => {
  afterEach(() => { TestBed.inject(MatDialog).closeAll(); localStorage.clear(); });

  it('nomme chaque bouton « Ouvrir » par le billet concerné', async () => {
    const { el } = await setup();
    expect(el.querySelector('button[aria-label]')?.getAttribute('aria-label')).toBe('Ouvrir le billet : Sous-titres décalés');
  });

  it('relit la liste à la fermeture du fil, même sans passer par « Fermer » (Échap, clic à côté)', async () => {
    const { fixture, ctl, el } = await setup();
    (el.querySelector('button[aria-label]') as HTMLButtonElement).click();
    fixture.detectChanges();
    ctl.match(r => r.url === '/api/support/tickets/t1').forEach(r => r.flush({ ticket: ticket().ticket, messages: [] }));

    TestBed.inject(MatDialog).closeAll(); // fermeture sans résultat, comme Échap
    // La fermeture de la fenêtre est animée : on attend que la liste redemande les billets.
    let reloads = ctl.match('/api/admin/tickets');
    for (let i = 0; i < 40 && reloads.length === 0; i++) { await new Promise(r => setTimeout(r, 25)); fixture.detectChanges(); reloads = ctl.match('/api/admin/tickets'); }
    expect(reloads).toHaveLength(1);
  });

  it('un chargement raté affiche une erreur avec « Réessayer », jamais « Aucun billet à traiter. Bon travail. »', async () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Support' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Tickets);
    const ctl = TestBed.inject(HttpTestingController);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => { fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges(); };

    fixture.detectChanges();
    ctl.expectOne('/api/admin/tickets').flush({}, { status: 503, statusText: 'Unavailable' });
    await settle();
    expect(el.textContent).toContain('Chargement impossible');
    expect(el.textContent).not.toContain('Bon travail');

    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Réessayer')!.click();
    await settle();
    ctl.expectOne('/api/admin/tickets').flush([ticket()]);
    await settle();
    expect(el.textContent).not.toContain('Chargement impossible');
    expect(el.textContent).toContain('Sous-titres décalés');
  });
});
