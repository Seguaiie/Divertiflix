import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { staffGuard } from './guards';
import type { AuthResponse } from './models';

const auth = (role: 'Admin' | 'Support' | 'Subscriber', at = 'AT', rt = 'RT'): AuthResponse =>
  ({ accessToken: at, refreshToken: rt, user: { id: '1', email: 'root', role } });

const KEY = 'divertiflix.admin.session';

function setup() {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'login', children: [] }]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
  });
  return { http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController), svc: TestBed.inject(AuthService) };
}

describe('AuthService', () => {
  it('stocke la session et expose le rôle', () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    expect(svc.isAdmin()).toBe(true);
    expect(svc.isStaff()).toBe(true);
    expect(JSON.parse(localStorage.getItem('divertiflix.admin.session')!).accessToken).toBe('AT');
  });

  it('un abonné n’est pas du personnel', () => {
    const { ctl, svc } = setup();
    svc.login('a', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Subscriber'));
    expect(svc.isStaff()).toBe(false);
  });
});

describe('authInterceptor', () => {
  it('ajoute le jeton aux appels API', () => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    http.get('/api/titles').subscribe();
    expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT');
  });

  it('sur 401 : un seul refresh partagé, puis rejoue les requêtes avec le nouveau jeton', () => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));

    const results: unknown[] = [];
    http.get('/api/titles').subscribe(r => results.push(r));
    http.get('/api/other').subscribe(r => results.push(r));
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectOne('/api/other').flush({}, { status: 401, statusText: 'Unauthorized' });

    // Rotation à usage unique : deux 401 simultanés ne doivent produire qu'UN appel de refresh.
    ctl.expectOne('/api/auth/refresh').flush(auth('Admin', 'AT2', 'RT2'));

    const retried = ctl.match(r => r.url === '/api/titles' || r.url === '/api/other');
    expect(retried.map(r => r.request.headers.get('Authorization'))).toEqual(['Bearer AT2', 'Bearer AT2']);
    retried.forEach(r => r.flush({ ok: true }));
    expect(results).toHaveLength(2);
  });

  it('si le serveur refuse le jeton : déconnexion (après le délai laissé à un autre onglet) et erreur propagée', () => {
    vi.useFakeTimers();
    try {
      const { http, ctl, svc } = setup();
      svc.login('root', 'x').subscribe();
      ctl.expectOne('/api/auth/login').flush(auth('Admin'));
      let status = 0;
      http.get('/api/titles').subscribe({ error: e => (status = e.status) });
      ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
      ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
      vi.advanceTimersByTime(1600);
      expect(status).toBe(401);
      expect(svc.user()).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it.each([
    ['429', (r: TestRequest) => r.flush({}, { status: 429, statusText: 'Too Many Requests' })],
    ['503', (r: TestRequest) => r.flush({}, { status: 503, statusText: 'Unavailable' })],
    ['réseau coupé', (r: TestRequest) => r.error(new ProgressEvent('error'))],
  ])('un refresh qui échoue de façon passagère (%s) garde la session et propage le 401 d\'origine', (_name, fail) => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    let status = 0;
    http.get('/api/titles').subscribe({ error: e => (status = e.status) });
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    fail(ctl.expectOne('/api/auth/refresh'));
    expect(status).toBe(401);
    expect(svc.user()).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe('RT');

    // La session n'est pas figée : le prochain 401 réessaie la rotation et réussit.
    http.get('/api/titles').subscribe();
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectOne('/api/auth/refresh').flush(auth('Admin', 'AT2', 'RT2'));
    expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT2');
  });

  it('un onglet qui a déjà perdu la rotation adopte la session du gagnant sans rejouer son jeton consommé', () => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    // L'autre onglet a fait tourner le jeton et écrit sa session dans le stockage partagé.
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } }));

    http.get('/api/titles').subscribe();
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectNone('/api/auth/refresh');
    expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT2');
    expect(svc.accessToken).toBe('AT2');
  });

  it('deux onglets qui font tourner le jeton en même temps : le perdant adopte le jeton du gagnant au lieu de tout fermer', () => {
    vi.useFakeTimers();
    try {
      const { http, ctl, svc } = setup();
      svc.login('root', 'x').subscribe();
      ctl.expectOne('/api/auth/login').flush(auth('Admin'));
      let status = 0;
      http.get('/api/titles').subscribe({ error: e => (status = e.status) });
      ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
      // Le serveur a donné la rotation à l'autre onglet : notre jeton est refusé...
      ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
      vi.advanceTimersByTime(500);
      expect(svc.user()).not.toBeNull();
      // ...et sa session arrive dans le stockage quelques instants plus tard.
      localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } }));
      vi.advanceTimersByTime(300);
      expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT2');
      expect(svc.user()).not.toBeNull();
      expect(status).toBe(0);
      expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe('RT2');
    } finally { vi.useRealTimers(); }
  });

  it('suit un autre onglet : session renouvelée, puis déconnexion', () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Support' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(svc.accessToken).toBe('AT2');
    expect(svc.isAdmin()).toBe(false);

    localStorage.removeItem(KEY);
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(svc.user()).toBeNull();
  });

  it('un compte abonné est révoqué sans écraser la session du personnel ouverte dans un autre onglet', () => {
    const { ctl, svc } = setup();
    const staff = JSON.stringify({ accessToken: 'ATS', refreshToken: 'RTS', user: { id: '9', email: 'agent', role: 'Support' } });
    localStorage.setItem(KEY, staff);
    svc.login('a', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Subscriber', 'ATA', 'RTA'));
    expect(localStorage.getItem(KEY)).toBe(staff);
    expect(ctl.expectOne('/api/auth/logout').request.body).toEqual({ refreshToken: 'RTA' });
  });

  it('la déconnexion révoque le jeton le plus récent, même renouvelé par un autre onglet', () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } }));
    svc.logout();
    expect(ctl.expectOne('/api/auth/logout').request.body).toEqual({ refreshToken: 'RT2' });
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});

describe('AuthService.freshAccessToken', () => {
  const jwt = (exp: number) => `h.${btoa(JSON.stringify({ exp }))}.s`;

  it('renvoie le jeton tel quel tant qu\'il reste plus de 20 s', async () => {
    const { ctl, svc } = setup();
    const at = jwt(Date.now() / 1000 + 600);
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin', at));
    await expect(svc.freshAccessToken()).resolves.toBe(at);
    ctl.expectNone('/api/auth/refresh');
  });

  it('renouvelle d\'avance un jeton périmé (reconnexion du temps réel après une longue absence)', async () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin', jwt(Date.now() / 1000 - 60)));
    const pending = svc.freshAccessToken();
    ctl.expectOne('/api/auth/refresh').flush(auth('Admin', 'AT2', 'RT2'));
    await expect(pending).resolves.toBe('AT2');
  });

  it('renvoie une chaîne vide sans session', async () => {
    const { svc } = setup();
    await expect(svc.freshAccessToken()).resolves.toBe('');
  });
});

describe('staffGuard', () => {
  it('redirige vers /login sans session', () => {
    setup();
    const res = TestBed.runInInjectionContext(() => staffGuard({} as never, {} as never));
    expect(TestBed.inject(Router).serializeUrl(res as never)).toBe('/login');
  });
});
