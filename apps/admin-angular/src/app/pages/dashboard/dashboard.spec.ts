import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Stats } from '../../core/models';
import { StatsStore } from '../../core/stats.store';
import { Dashboard } from './dashboard';

const stats = (over: Partial<Stats> = {}): Stats => ({
  titles: 12, playable: 9, movies: 6, series: 4, audiobooks: 2, byGenre: [], users: 5, activeUsers: 4, staff: 2,
  requestsPending: 3, requestsInProgress: 1, ticketsOpen: 2, activeProfiles7d: 4, plays24h: 40, ...over,
});

const ERROR = 'Impossible de charger les statistiques.';

function setup(role: 'Admin' | 'Support') {
  localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role } }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  const ctl = TestBed.inject(HttpTestingController);
  ctl.match(r => r.url === '/api/admin/stats' || r.url === '/api/status').forEach(r => r.flush(null));
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const kpi = (el: HTMLElement, text: string) => [...el.querySelectorAll('.kpi')].find(k => k.textContent!.includes(text))!;

describe('Dashboard', () => {
  afterEach(() => localStorage.clear());

  it('« Comptes actifs » mène à la gestion des comptes pour un administrateur', () => {
    expect(kpi(setup('Admin'), 'Comptes actifs').getAttribute('href')).toBe('/users');
  });

  it('affiche le bandeau d\'erreur quand les statistiques n\'ont jamais pu être lues, et le retire dès qu\'elles arrivent', () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Dashboard);
    const el = fixture.nativeElement as HTMLElement;
    const ctl = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    ctl.match('/api/status').forEach(r => r.flush(null));
    ctl.expectOne('/api/admin/stats').flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(ERROR);

    TestBed.inject(StatsStore).refresh();
    ctl.expectOne('/api/admin/stats').flush(stats());
    fixture.detectChanges();
    expect(el.textContent).not.toContain(ERROR);
    expect(kpi(el, 'Demandes en attente').textContent).toContain('3');
  });

  it('un rechargement raté garde les derniers chiffres sans bandeau d\'erreur', () => {
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Dashboard);
    const el = fixture.nativeElement as HTMLElement;
    const ctl = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    ctl.match('/api/status').forEach(r => r.flush(null));
    ctl.expectOne('/api/admin/stats').flush(stats());
    fixture.detectChanges();

    TestBed.inject(StatsStore).refresh();
    ctl.expectOne('/api/admin/stats').flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(el.textContent).not.toContain(ERROR);
    expect(kpi(el, 'Demandes en attente').textContent).toContain('3');
  });

  it('« Comptes actifs » n\'est pas un lien pour le rôle Support (la page lui est interdite)', () => {
    const el = setup('Support');
    expect(kpi(el, 'Comptes actifs').getAttribute('href')).toBeNull();
    expect(kpi(el, 'Titres lisibles').getAttribute('href')).toBe('/catalog');
  });
});
