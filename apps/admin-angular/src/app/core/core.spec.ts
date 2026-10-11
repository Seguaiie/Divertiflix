import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { provideRouter, Router } from '@angular/router';
import { routes } from '../app.routes';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { guestGuard, staffGuard } from './guards';
import type { AuthResponse } from './models';

const auth = (role: 'Admin' | 'Support' | 'Subscriber', at = 'AT', rt = 'RT'): AuthResponse =>
  ({ accessToken: at, refreshToken: rt, user: { id: '1', email: 'root', role } });

const KEY = 'divertiflix.admin.session';

function setup() {
  localStorage.clear();
  TestBed.configureTestingModule({
    providers: [provideRouter([{ path: 'login', children: [] }, { path: '', pathMatch: 'full', children: [] }]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()],
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

  it('si le serveur refuse le jeton : déconnexion (après la tolérance de rejeu de l\'API, 10 s) et erreur propagée', () => {
    vi.useFakeTimers();
    try {
      const { http, ctl, svc } = setup();
      svc.login('root', 'x').subscribe();
      ctl.expectOne('/api/auth/login').flush(auth('Admin'));
      let status = 0;
      http.get('/api/titles').subscribe({ error: e => (status = e.status) });
      ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
      ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
      vi.advanceTimersByTime(9_000);
      expect(svc.user()).not.toBeNull(); // un autre onglet peut encore écrire la session qu'il vient d'obtenir
      vi.advanceTimersByTime(1_000);
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

  it('sans verrou partagé : un gagnant dont la réponse tarde (4 s) ne fait pas vider la session du perdant', () => {
    vi.useFakeTimers();
    try {
      const { http, ctl, svc } = setup();
      svc.login('root', 'x').subscribe();
      ctl.expectOne('/api/auth/login').flush(auth('Admin'));
      let status = 0;
      http.get('/api/titles').subscribe({ error: e => (status = e.status) });
      ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
      ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
      vi.advanceTimersByTime(4_000);
      // Le gagnant n'a toujours pas écrit sa session : ce n'est pas un refus définitif, le stockage partagé reste intact.
      expect(svc.user()).not.toBeNull();
      expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe('RT');
      localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } }));
      vi.advanceTimersByTime(250);
      expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT2');
      expect(status).toBe(0);
      expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe('RT2');
    } finally { vi.useRealTimers(); }
  });

  it('un agent rétrogradé en cours de session revient à la connexion avec un message, et le jeton fraîchement émis est révoqué', async () => {
    const { http, ctl, svc } = setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate');
    svc.login('agent', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Support'));
    let status = 0;
    http.get('/api/titles').subscribe({ error: e => (status = e.status) });
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    // L'API refuse l'ancien jeton (rôle périmé) ; le rafraîchissement donne un jeton au nouveau rôle.
    ctl.expectOne('/api/auth/refresh').flush(auth('Subscriber', 'AT2', 'RT2'));

    ctl.expectNone('/api/titles'); // aucun rejeu avec un jeton d'abonné : ce serait un 403 en boucle
    expect(status).toBe(401);
    expect(svc.user()).toBeNull();
    expect(svc.isStaff()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(ctl.expectOne('/api/auth/logout').request.body).toEqual({ refreshToken: 'RT2' });
    expect(navigate).toHaveBeenCalledWith(['/login']);
    expect(svc.notice()).toBe('Votre rôle a changé : ce compte n\'a plus accès au back-office.');

    // Une nouvelle tentative de connexion efface l'explication.
    svc.login('agent', 'x').subscribe();
    expect(svc.notice()).toBeNull();
    ctl.expectOne('/api/auth/login');
  });

  it('un renouvellement d\'avance (temps réel) pour un compte rétrogradé ne rend aucun jeton', async () => {
    const { ctl, svc } = setup();
    svc.login('agent', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Support', `h.${btoa(JSON.stringify({ exp: Date.now() / 1000 - 60 }))}.s`));
    const pending = svc.freshAccessToken();
    ctl.expectOne('/api/auth/refresh').flush(auth('Subscriber', 'AT2', 'RT2'));
    await expect(pending).resolves.toBe('');
    expect(svc.user()).toBeNull();
  });

  it('un rôle qui change mais reste du personnel (Admin vers Support) garde la session', () => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    http.get('/api/titles').subscribe();
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectOne('/api/auth/refresh').flush(auth('Support', 'AT2', 'RT2'));
    expect(svc.isStaff()).toBe(true);
    expect(svc.isAdmin()).toBe(false);
    expect(ctl.expectOne('/api/titles').request.headers.get('Authorization')).toBe('Bearer AT2');
    ctl.expectNone('/api/auth/logout');
  });

  it('une connexion dans un autre onglet fait quitter la page de connexion', async () => {
    const { svc } = setup();
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/login');
    const navigate = vi.spyOn(router, 'navigate');
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT', refreshToken: 'RT', user: { id: '1', email: 'root', role: 'Admin' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(svc.isStaff()).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/']);
  });

  it('une session renouvelée dans un autre onglet ne déplace pas celui qui travaille ailleurs que sur la page de connexion', async () => {
    const { ctl, svc } = setup();
    const router = TestBed.inject(Router);
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    await router.navigateByUrl('/');
    const navigate = vi.spyOn(router, 'navigate');
    localStorage.setItem(KEY, JSON.stringify({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    expect(svc.accessToken).toBe('AT2');
    expect(navigate).not.toHaveBeenCalled();
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

/** Faux gestionnaire de verrous du navigateur : un seul détenteur à la fois, les autres demandes attendent leur tour (comme navigator.locks). */
function installLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  const request = vi.fn((_name: string, work: () => Promise<unknown>) => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  });
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  return request;
}
const pump = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe('AuthService entre onglets, avec verrou partagé', () => {
  afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); vi.useRealTimers(); });

  /** Deux « onglets » : deux services qui partagent le stockage local et le client HTTP. */
  function twoTabs() {
    const request = installLocks();
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    const other = TestBed.runInInjectionContext(() => new AuthService());
    return { ctl, svc, other, request };
  }

  it('deux onglets qui rafraîchissent en même temps : un seul appel, l\'autre adopte la session obtenue sans appel réseau', async () => {
    const { ctl, svc, other, request } = twoTabs();
    const first = firstValueFrom(svc.refresh());
    const second = firstValueFrom(other.refresh());
    await pump();

    // Le second onglet attend le verrou : il n'envoie rien tant que le premier n'a pas écrit sa session, aussi lente soit la réponse.
    const calls = ctl.match('/api/auth/refresh');
    expect(calls).toHaveLength(1);
    expect(calls[0].request.body).toEqual({ refreshToken: 'RT' });
    expect(request).toHaveBeenCalledTimes(2);
    calls[0].flush(auth('Admin', 'AT2', 'RT2'));
    await expect(first).resolves.toBe('AT2');
    await expect(second).resolves.toBe('AT2');
    ctl.expectNone('/api/auth/refresh');
    expect(other.accessToken).toBe('AT2');
    expect(svc.accessToken).toBe('AT2');
    expect(JSON.parse(localStorage.getItem(KEY)!).refreshToken).toBe('RT2');
  });

  it('un refus obtenu sous verrou est définitif : déconnexion immédiate, sans attendre un gagnant qui n\'existe pas', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const { ctl, svc } = twoTabs();
    const pending = firstValueFrom(svc.refresh());
    await pump();
    ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    await pump();
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBeNull();
    expect(svc.user()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('un verrou refusé par le navigateur (page sandboxée) ne bloque pas le rafraîchissement', async () => {
    const { ctl, svc, request } = twoTabs();
    request.mockImplementation(() => Promise.reject(new DOMException('refusé', 'SecurityError')));
    const pending = firstValueFrom(svc.refresh());
    await pump();
    ctl.expectOne('/api/auth/refresh').flush(auth('Admin', 'AT2', 'RT2'));
    await expect(pending).resolves.toBe('AT2');
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

  it('le seuil est de 20 s : à 25 s de l\'échéance le jeton est gardé, à 15 s il est renouvelé', async () => {
    const { ctl, svc } = setup();
    const near = jwt(Date.now() / 1000 + 25);
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin', near));
    await expect(svc.freshAccessToken()).resolves.toBe(near);
    ctl.expectNone('/api/auth/refresh');

    localStorage.setItem(KEY, JSON.stringify({ accessToken: jwt(Date.now() / 1000 + 15), refreshToken: 'RT', user: { id: '1', email: 'root', role: 'Admin' } }));
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    const pending = svc.freshAccessToken();
    ctl.expectOne('/api/auth/refresh').flush(auth('Admin', 'AT2', 'RT2'));
    await expect(pending).resolves.toBe('AT2');
  });

  it('un jeton dont on ne lit pas l\'échéance est présenté tel quel (le serveur tranche)', async () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin', 'opaque'));
    await expect(svc.freshAccessToken()).resolves.toBe('opaque');
    ctl.expectNone('/api/auth/refresh');
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

describe('guestGuard', () => {
  it('laisse voir la page de connexion sans session du personnel', () => {
    setup();
    expect(TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never))).toBe(true);
  });

  it('renvoie vers le tableau de bord quand une session du personnel est déjà ouverte (autre onglet, rechargement)', () => {
    const { ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Support'));
    const res = TestBed.runInInjectionContext(() => guestGuard({} as never, {} as never));
    expect(TestBed.inject(Router).serializeUrl(res as never)).toBe('/dashboard');
  });
});

describe('routes', () => {
  const route = (path: string) => routes.find(r => r.path === path)!;

  it('la page de connexion est gardée par guestGuard', () => {
    expect(route('login').canActivate).toEqual([guestGuard]);
  });

  it('le personnel est vérifié à chaque navigation entre pages, pas seulement à l\'entrée de la console', () => {
    expect(route('').canActivate).toEqual([staffGuard]);
    expect(route('').canActivateChild).toEqual([staffGuard]);
  });
});
