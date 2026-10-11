import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AdminUser } from '../../core/models';
import { Users } from './users';

const user = (over: Partial<AdminUser>): AdminUser => ({
  id: 'u2', email: 'camille@test.com', role: 'Subscriber', source: 'Local', isActive: true, createdAt: '2026-10-09T12:00:00Z', profiles: 1, ...over,
});

async function setup(items: AdminUser[] = [user({ id: 'u1', email: 'root', role: 'Admin' }), user({})]) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(Users);
  const ctl = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  await vi.advanceTimersByTimeAsync(400); // délai de la recherche
  ctl.expectOne(r => r.url === '/api/admin/users').flush({ items, total: items.length, page: 1, pageSize: 15 });
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
}

describe('Users', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('nomme chaque commande par le compte concerné (lecteurs d\'écran)', async () => {
    const { el } = await setup();
    const switches = [...el.querySelectorAll('button[role="switch"]')].map(b => b.getAttribute('aria-label'));
    expect(switches).toEqual(['Compte actif : root', 'Compte actif : camille@test.com']);
    const selects = [...el.querySelectorAll('mat-select')].map(s => s.getAttribute('aria-label'));
    expect(selects).toEqual(['Rôle de root', 'Rôle de camille@test.com']);
  });

  it('empêche de modifier son propre compte', async () => {
    const { el } = await setup();
    const own = el.querySelectorAll('button[role="switch"]')[0] as HTMLButtonElement;
    expect(own.disabled).toBe(true);
    expect((el.querySelectorAll('button[role="switch"]')[1] as HTMLButtonElement).disabled).toBe(false);
  });

  it('remet l\'interrupteur dans son état quand le serveur refuse (dernier administrateur, etc.)', async () => {
    const { fixture, ctl, el } = await setup();
    const toggle = el.querySelectorAll('button[role="switch"]')[1] as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
    const put = ctl.expectOne('/api/admin/users/u2');
    expect(put.request.body).toEqual({ isActive: false });
    put.flush({ detail: 'Il doit rester au moins un administrateur actif.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    // La liste est relue pour afficher l'état réel du serveur.
    ctl.expectOne(r => r.url === '/api/admin/users');
  });

  it('un second changement est ignoré tant que le premier est en cours d\'envoi, puis redevient possible', async () => {
    const { fixture, ctl, el } = await setup([user({ id: 'u1', email: 'root', role: 'Admin' }), user({}), user({ id: 'u3', email: 'dominique@test.com' })]);
    const toggles = [...el.querySelectorAll('button[role="switch"]')] as HTMLButtonElement[];
    toggles[1].click();
    fixture.detectChanges();
    const first = ctl.expectOne('/api/admin/users/u2');

    toggles[2].click(); // le premier envoi n'est pas terminé
    fixture.detectChanges();
    ctl.expectNone('/api/admin/users/u3');
    expect(toggles[2].getAttribute('aria-checked')).toBe('true'); // la commande revient à son état : rien n'a été envoyé

    first.flush(user({ isActive: false }));
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    ctl.expectOne(r => r.url === '/api/admin/users').flush({ items: [user({ id: 'u1', email: 'root', role: 'Admin' }), user({ isActive: false }), user({ id: 'u3', email: 'dominique@test.com' })], total: 3, page: 1, pageSize: 15 });
    fixture.detectChanges();

    toggles[2].click();
    fixture.detectChanges();
    expect(ctl.expectOne('/api/admin/users/u3').request.body).toEqual({ isActive: false });
  });

  it('un chargement raté affiche une erreur avec « Réessayer », jamais « Aucun compte » (liste vide trompeuse)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Users);
    const ctl = TestBed.inject(HttpTestingController);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => { fixture.detectChanges(); await vi.advanceTimersByTimeAsync(400); fixture.detectChanges(); };

    await settle();
    ctl.expectOne(r => r.url === '/api/admin/users').flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el.textContent).toContain('Chargement impossible');
    expect(el.textContent).not.toContain('Aucun compte');

    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Réessayer')!.click();
    await settle();
    ctl.expectOne(r => r.url === '/api/admin/users').flush({ items: [user({})], total: 1, page: 1, pageSize: 15 });
    await settle();
    expect(el.textContent).not.toContain('Chargement impossible');
    expect(el.textContent).toContain('camille@test.com');
  });
});
