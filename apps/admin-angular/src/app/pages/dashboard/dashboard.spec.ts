import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';

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

  it('« Comptes actifs » n\'est pas un lien pour le rôle Support (la page lui est interdite)', () => {
    const el = setup('Support');
    expect(kpi(el, 'Comptes actifs').getAttribute('href')).toBeNull();
    expect(kpi(el, 'Titres lisibles').getAttribute('href')).toBe('/catalog');
  });
});
