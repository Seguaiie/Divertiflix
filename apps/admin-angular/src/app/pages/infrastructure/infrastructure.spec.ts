import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { ServiceProbe } from '../../core/models';
import { Infrastructure } from './infrastructure';

const NOW = new Date('2026-11-09T16:30:00Z');
const probe = (over: Partial<ServiceProbe>): ServiceProbe => ({
  key: 'jellyfin', name: 'Jellyfin', url: 'https://jellyfin.home.arpa/', portal: true, state: 'up', latencyMs: 285, httpCode: 302,
  tls: 'untrusted', certNotAfter: '2026-11-09T21:37:35Z', certIssuer: 'CN=divertiflixCA Intermediate CA', error: null,
  checkedAt: '2026-11-09T16:29:50Z', since: '2026-11-09T14:30:00Z', ...over,
});

async function setup(rows: ServiceProbe[]) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
  localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: 'u1', email: 'root', role: 'Admin' } }));
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(Infrastructure);
  const ctl = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  ctl.expectOne('/api/admin/services').flush(rows);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, ctl, el: fixture.nativeElement as HTMLElement };
}

describe('Infrastructure', () => {
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  it('montre l\'état mesuré, la raison d\'une panne et l\'échéance proche des certificats de 24 h', async () => {
    const { el } = await setup([
      probe({}),
      probe({ key: 'homarr', name: 'Homarr', state: 'down', tls: 'traefik-default', certNotAfter: '2027-11-08T00:00:00Z', error: 'Route absente dans Traefik (certificat par défaut)' }),
      probe({ key: 'flaresolverr', name: 'FlareSolverr', url: null, portal: false, state: 'noui', latencyMs: null, httpCode: null, tls: null, certNotAfter: null, since: null }),
    ]);
    const rows = [...el.querySelectorAll('tr.mat-mdc-row')];
    expect(rows.map(r => r.querySelector('.name')?.textContent?.trim())).toEqual(['Jellyfin', 'Homarr', 'FlareSolverr']);

    const jellyfin = rows[0]!;
    expect(jellyfin.textContent).toContain('En ligne');
    expect(jellyfin.textContent).toContain('285 ms');
    expect(jellyfin.textContent).toContain('Autorité inconnue de ce serveur');
    expect(jellyfin.querySelector('.cell-sub.soon')?.textContent).toBe('expire dans 5 h 07');   // moins de 6 h : en alerte
    expect(jellyfin.querySelector('a.name')?.getAttribute('rel')).toBe('noopener noreferrer');

    expect(rows[1]!.textContent).toContain('Hors ligne');
    expect(rows[1]!.textContent).toContain('Route absente dans Traefik');
    expect(rows[2]!.textContent).toContain('Sans interface web');
    expect(rows[2]!.querySelector('a')).toBeNull();

    const summary = el.querySelector('.summary')!.textContent!;
    expect(summary).toContain('1 en ligne');
    expect(summary).toContain('1 hors ligne');
    expect(summary).toContain('1 certificat(s) expirent dans moins de 6 h');
  });

  it('« Vérifier maintenant » demande une sonde immédiate, puis la page se relit toute seule', async () => {
    const { fixture, ctl, el } = await setup([probe({})]);
    (el.querySelector('button.refresh') as HTMLButtonElement).click();
    ctl.expectOne(r => r.method === 'POST' && r.url === '/api/admin/services/refresh').flush([probe({ latencyMs: 120 })]);
    fixture.detectChanges();
    expect(el.textContent).toContain('120 ms');

    await vi.advanceTimersByTimeAsync(30_000);
    ctl.expectOne('/api/admin/services').flush([probe({ latencyMs: 99 })]);
    fixture.detectChanges();
    expect(el.textContent).toContain('99 ms');
    ctl.verify();
  });
});
