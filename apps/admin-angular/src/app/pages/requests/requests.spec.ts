import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { authInterceptor } from '../../core/auth.interceptor';
import type { AdminRequest } from '../../core/models';
import { Requests } from './requests';

const req = (over: Partial<AdminRequest>): AdminRequest => ({
  id: 'r1', name: 'Nosferatu', kind: 'Movie', year: 1922, note: 'Version restaurée', status: 'Pending', titleId: null,
  requestedBy: 'camille@test.com', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over,
});

function setup(role: 'Admin' | 'Support') {
  localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role } }));
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
  });
  const fixture = TestBed.createComponent(Requests);
  const ctl = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
}

const buttons = (el: HTMLElement) => [...el.querySelectorAll('button')].map(b => b.textContent!.trim());

describe('Requests', () => {
  afterEach(() => localStorage.clear());

  it('liste les demandes à traiter et propose les actions valides à un administrateur', async () => {
    const { fixture, ctl, el } = setup('Admin');
    ctl.expectOne(r => r.url === '/api/admin/requests').flush([
      req({ id: 'a', name: 'Nosferatu', status: 'Pending' }),
      req({ id: 'b', name: 'Metropolis', status: 'Approved' }),
      req({ id: 'c', name: 'Vieux film', status: 'Available' }),
    ]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const text = el.textContent!;
    expect(text).toContain('Nosferatu');
    expect(text).toContain('Metropolis');
    expect(text).not.toContain('Vieux film'); // « disponible » n'est pas « à traiter »
    expect(text).toContain('À traiter (2)');
    const labels = buttons(el);
    expect(labels).toContain('Approuver');
    expect(labels).toContain('Télécharger');
    expect(labels).toContain('Rendre disponible');
  });

  it("envoie la décision à l'API sans dialogue quand elle n'exige rien de plus", async () => {
    const { fixture, ctl, el } = setup('Admin');
    ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', status: 'Pending' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Approuver')!.click();
    const put = ctl.expectOne('/api/admin/requests/a');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toMatchObject({ status: 'Approved' });
    put.flush(req({ id: 'a', status: 'Approved' }));
  });

  it('nomme chaque action par la demande concernée (plusieurs lignes portent le même verbe)', async () => {
    const { fixture, ctl, el } = setup('Admin');
    ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', name: 'Nosferatu', status: 'Pending' }), req({ id: 'b', name: 'Metropolis', status: 'Pending' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const names = [...el.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'));
    expect(names).toEqual(['Approuver : Nosferatu', 'Refuser : Nosferatu', 'Approuver : Metropolis', 'Refuser : Metropolis']);
  });

  it("n'offre aucune action au rôle Support (lecture seule)", async () => {
    const { fixture, ctl, el } = setup('Support');
    ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ status: 'Pending' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(buttons(el)).not.toContain('Approuver');
    expect(el.textContent).toContain('Nosferatu');
  });

  it('après une décision qui retire la ligne, le focus clavier revient sur la page au lieu de tomber sur <body>', async () => {
    const main = document.createElement('main');
    main.id = 'main';
    main.tabIndex = -1;
    document.body.append(main);
    try {
      const { fixture, ctl, el } = setup('Admin');
      ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', status: 'Pending' })]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const approve = [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Approuver')!;
      approve.focus();
      expect(document.activeElement).toBe(approve);

      approve.click();
      ctl.expectOne('/api/admin/requests/a').flush(req({ id: 'a', status: 'Available' }));
      fixture.detectChanges();
      await fixture.whenStable();
      ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', status: 'Available' })]); // plus « à traiter » : la ligne disparaît
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(el.textContent).not.toContain('Nosferatu');
      expect(document.activeElement).toBe(main);
    } finally { main.remove(); }
  });

  it('une décision qui garde la ligne ne déplace pas le focus', async () => {
    const main = document.createElement('main');
    main.id = 'main';
    main.tabIndex = -1;
    document.body.append(main);
    try {
      const { fixture, ctl, el } = setup('Admin');
      ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', status: 'Pending' })]);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const approve = [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Approuver')!;
      approve.focus();

      approve.click();
      ctl.expectOne('/api/admin/requests/a').flush(req({ id: 'a', status: 'Approved' }));
      fixture.detectChanges();
      await fixture.whenStable();
      ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ id: 'a', status: 'Approved' })]); // toujours à traiter : la ligne reste
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(document.activeElement).toBe(approve);
    } finally { main.remove(); }
  });

  it('un chargement raté affiche une erreur avec « Réessayer », jamais « Rien à afficher » (liste vide trompeuse)', async () => {
    const { fixture, ctl, el } = setup('Admin');
    ctl.expectOne(r => r.url === '/api/admin/requests').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).toContain('Chargement impossible');
    expect(el.textContent).not.toContain('Rien à afficher');

    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Réessayer')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    ctl.expectOne(r => r.url === '/api/admin/requests').flush([req({ status: 'Pending' })]);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Chargement impossible');
    expect(el.textContent).toContain('Nosferatu');
  });
});
