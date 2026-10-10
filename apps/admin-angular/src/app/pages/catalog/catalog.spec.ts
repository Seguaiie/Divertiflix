import { type HttpRequest, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import type { AdminTitle } from '../../core/models';
import { Catalog } from './catalog';

const title = (n: number): AdminTitle => ({ id: `t${n}`, name: `Titre ${n}`, kind: 'Movie', year: 2000, genre: 'Drame', durationMinutes: 90, isPlayable: true, streamKind: 'Hls' } as AdminTitle);

describe('Catalog', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }));
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('revient à la nouvelle dernière page quand la dernière se vide, sans afficher « Aucun titre »', async () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Catalog);
    const ctl = TestBed.inject(HttpTestingController);
    const pageOf = (r: HttpRequest<unknown>) => r.params.get('page');
    const settle = async () => { fixture.detectChanges(); await vi.advanceTimersByTimeAsync(400); fixture.detectChanges(); };

    await settle();
    ctl.expectOne(r => r.url === '/api/admin/titles' && pageOf(r) === '1').flush({ items: [title(1)], total: 37, page: 1, pageSize: 12 });
    await settle();

    // L'administrateur est sur la page 4 (le titre 37) et le supprime : le serveur n'a plus que 36 titres, donc 3 pages.
    (fixture.componentInstance as unknown as { onPage(e: { pageIndex: number }): void }).onPage({ pageIndex: 3 });
    await settle();
    ctl.expectOne(r => r.url === '/api/admin/titles' && pageOf(r) === '4').flush({ items: [], total: 36, page: 4, pageSize: 12 });
    await settle();

    ctl.expectOne(r => r.url === '/api/admin/titles' && pageOf(r) === '3').flush({ items: [title(25)], total: 36, page: 3, pageSize: 12 });
    await settle();
    expect(fixture.nativeElement.textContent).not.toContain('Aucun titre');
    expect(fixture.nativeElement.textContent).toContain('Titre 25');
  });

  it('après la suppression d\'un titre, le focus clavier (perdu avec le bouton) revient sur la page', async () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    // La fenêtre de confirmation (et ses animations) n'est pas l'objet du test : l'administrateur confirme aussitôt.
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } }],
    });
    const main = document.createElement('main');
    main.id = 'main';
    main.tabIndex = -1;
    document.body.append(main);
    try {
      const fixture = TestBed.createComponent(Catalog);
      const ctl = TestBed.inject(HttpTestingController);
      const settle = async () => { fixture.detectChanges(); await vi.advanceTimersByTimeAsync(400); fixture.detectChanges(); };
      const list = (items: AdminTitle[]) => ctl.expectOne(r => r.url === '/api/admin/titles').flush({ items, total: items.length, page: 1, pageSize: 12 });

      await settle();
      list([title(1), title(2)]);
      await settle();

      const del = fixture.nativeElement.querySelector('button[aria-label="Supprimer Titre 1"]') as HTMLButtonElement;
      del.focus();
      expect(document.activeElement).toBe(del);
      del.click();
      ctl.expectOne('/api/admin/titles/t1').flush(null);
      await settle();
      list([title(2)]);
      await settle();

      expect(fixture.nativeElement.textContent).not.toContain('Titre 1');
      expect(document.activeElement).toBe(main);
    } finally { main.remove(); }
  });

  it('un chargement raté affiche une erreur avec « Réessayer », jamais « Aucun titre » (liste vide trompeuse)', async () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Catalog);
    const ctl = TestBed.inject(HttpTestingController);
    const el = fixture.nativeElement as HTMLElement;
    const settle = async () => { fixture.detectChanges(); await vi.advanceTimersByTimeAsync(400); fixture.detectChanges(); };

    await settle();
    ctl.expectOne(r => r.url === '/api/admin/titles').flush({}, { status: 500, statusText: 'Server Error' });
    await settle();
    expect(el.textContent).toContain('Chargement impossible');
    expect(el.textContent).not.toContain('Aucun titre');

    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === 'Réessayer')!.click();
    await settle();
    ctl.expectOne(r => r.url === '/api/admin/titles').flush({ items: [title(1)], total: 1, page: 1, pageSize: 12 });
    await settle();
    expect(el.textContent).not.toContain('Chargement impossible');
    expect(el.textContent).toContain('Titre 1');
  });
});
