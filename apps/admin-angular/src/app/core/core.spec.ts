import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { staffGuard } from './guards';
import type { AuthResponse } from './models';

const auth = (role: 'Admin' | 'Support' | 'Subscriber', at = 'AT', rt = 'RT'): AuthResponse =>
  ({ accessToken: at, refreshToken: rt, user: { id: '1', email: 'root', role } });

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

  it('si le refresh échoue : déconnexion et erreur propagée', () => {
    const { http, ctl, svc } = setup();
    svc.login('root', 'x').subscribe();
    ctl.expectOne('/api/auth/login').flush(auth('Admin'));
    let status = 0;
    http.get('/api/titles').subscribe({ error: e => (status = e.status) });
    ctl.expectOne('/api/titles').flush({}, { status: 401, statusText: 'Unauthorized' });
    ctl.expectOne('/api/auth/refresh').flush({}, { status: 401, statusText: 'Unauthorized' });
    expect(status).toBe(401);
    expect(svc.user()).toBeNull();
  });
});

describe('staffGuard', () => {
  it('redirige vers /login sans session', () => {
    setup();
    const res = TestBed.runInInjectionContext(() => staffGuard({} as never, {} as never));
    expect(TestBed.inject(Router).serializeUrl(res as never)).toBe('/login');
  });
});
