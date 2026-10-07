import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, map, Observable, of, shareReplay, tap, finalize } from 'rxjs';
import type { AuthResponse, User } from './models';

const SESSION = 'divertiflix.admin.session';

interface Session { accessToken: string; refreshToken: string; user: User }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly session = signal<Session | null>(this.read());
  readonly user = computed(() => this.session()?.user ?? null);
  readonly isStaff = computed(() => ['Admin', 'Support'].includes(this.user()?.role ?? ''));
  readonly isAdmin = computed(() => this.user()?.role === 'Admin');

  /** Refresh en cours partagé : le refresh token est à usage unique (rotation côté API). */
  private refreshing$?: Observable<string | null>;

  get accessToken(): string | null { return this.session()?.accessToken ?? null; }

  login(email: string, password: string): Observable<User> {
    return this.http.post<AuthResponse>('/api/auth/login', { email, password }).pipe(
      tap(r => this.store(r)),
      map(r => r.user),
    );
  }

  /** Renvoie un nouveau jeton d'accès, ou null (et déconnecte) si la session est expirée. */
  refresh(): Observable<string | null> {
    const s = this.session();
    if (!s) return of(null);
    this.refreshing$ ??= this.http.post<AuthResponse>('/api/auth/refresh', { refreshToken: s.refreshToken }).pipe(
      tap(r => this.store(r)),
      map(r => r.accessToken),
      catchError(() => { this.logout(); return of(null); }),
      finalize(() => (this.refreshing$ = undefined)),
      shareReplay(1),
    );
    return this.refreshing$;
  }

  logout(): void {
    localStorage.removeItem(SESSION);
    this.session.set(null);
    void this.router.navigate(['/login']);
  }

  private store(r: AuthResponse): void {
    const s: Session = { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
    localStorage.setItem(SESSION, JSON.stringify(s));
    this.session.set(s);
  }

  private read(): Session | null {
    try { return JSON.parse(localStorage.getItem(SESSION) ?? 'null'); } catch { return null; }
  }
}
