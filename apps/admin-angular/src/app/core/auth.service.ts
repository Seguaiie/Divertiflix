import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, defer, finalize, first, firstValueFrom, from, map, Observable, of, shareReplay, take, tap, timer } from 'rxjs';
import { jwtExpiry } from './jwt';
import type { AuthResponse, User } from './models';

const SESSION = 'divertiflix.admin.session';
const STAFF = ['Admin', 'Support'];

/** Verrou partagé par les onglets du navigateur : un seul rafraîchissement à la fois, les autres relisent ensuite la session obtenue. */
const REFRESH_LOCK = 'divertiflix-admin-refresh';

/**
 * Sans verrou (navigator.locks n'existe pas sur une page servie en HTTP hors localhost), un autre onglet a pu gagner la rotation sans que
 * l'on sache où il en est, et sa réponse peut tarder : on lui laisse la tolérance de rejeu de l'API (AuthController.ReplayGrace, 10 s)
 * avant de conclure à un refus définitif, car celui-ci vide la session de tous les onglets.
 */
const ROTATION_GRACE_MS = 10_000;

interface Session { accessToken: string; refreshToken: string; user: User }

/** Seule une réponse 400 ou 401 prouve que le jeton de rafraîchissement est perdu : un 429, un 5xx ou un réseau coupé sont passagers. */
const isRejected = (e: unknown) => e instanceof HttpErrorResponse && (e.status === 400 || e.status === 401);

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly session = signal<Session | null>(this.read());
  readonly user = computed(() => this.session()?.user ?? null);
  readonly isStaff = computed(() => STAFF.includes(this.user()?.role ?? ''));
  readonly isAdmin = computed(() => this.user()?.role === 'Admin');
  /** Pourquoi l'agent a été renvoyé à la connexion sans l'avoir demandé : le formulaire l'explique. */
  readonly notice = signal<string | null>(null);

  /** Refresh en cours partagé : le refresh token est à usage unique (rotation côté API). */
  private refreshing$?: Observable<string | null>;

  constructor() {
    // La session vit dans le stockage local, partagé entre onglets : on suit ce que fait un autre onglet (connexion, rotation, déconnexion).
    const onStorage = (e: StorageEvent) => { if (e.key === SESSION || e.key === null) this.follow(); };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  get accessToken(): string | null { return this.session()?.accessToken ?? null; }

  /** Seul un compte du personnel garde sa session : un abonné est révoqué aussitôt, sans écraser la session d'un autre onglet. */
  login(email: string, password: string): Observable<User> {
    this.notice.set(null);
    return this.http.post<AuthResponse>('/api/auth/login', { email, password }).pipe(
      tap(r => (STAFF.includes(r.user.role) ? this.store(r) : this.revoke(r.refreshToken))),
      map(r => r.user),
    );
  }

  /**
   * Renvoie un nouveau jeton d'accès, ou null. La session n'est vidée (et l'utilisateur renvoyé à la connexion) que si le serveur
   * refuse le jeton ; sur un échec passager (429, 5xx, réseau) elle est gardée et le prochain 401 réessaiera.
   */
  refresh(): Observable<string | null> {
    const s = this.session();
    if (!s) return of(null);
    this.refreshing$ ??= this.rotate(s.refreshToken).pipe(
      finalize(() => (this.refreshing$ = undefined)),
      shareReplay(1),
    );
    return this.refreshing$;
  }

  /** Jeton valable au moins 20 s : renouvelé d'avance pour les connexions longues (SignalR), sans attendre un 401. */
  async freshAccessToken(): Promise<string> {
    const s = this.session();
    if (!s) return '';
    const exp = jwtExpiry(s.accessToken);
    if (exp !== null && exp - Date.now() / 1000 < 20) return (await firstValueFrom(this.refresh())) ?? '';
    return s.accessToken;
  }

  /** Révoque la session côté serveur (sans attendre), puis oublie les jetons : « se déconnecter » coupe réellement la session. */
  logout(): void {
    const s = this.read() ?? this.session(); // le jeton le plus récent, peut-être renouvelé par un autre onglet
    if (s) this.revoke(s.refreshToken);
    this.clear();
  }

  /**
   * Rotation du jeton, un onglet à la fois quand le navigateur offre des verrous : ceux qui attendent le verrou relisent le stockage
   * une fois obtenu et adoptent la session du premier, sans appel réseau (et sans que la lenteur de sa réponse y change quoi que ce soit).
   * Un refus reçu sous verrou est donc définitif.
   */
  private rotate(sent: string): Observable<string | null> {
    const locks = navigator.locks as LockManager | undefined;
    if (!locks) return this.exchange(sent, ROTATION_GRACE_MS);
    return defer(() => from(locks.request(REFRESH_LOCK, () => firstValueFrom(this.exchange(sent, 0))))).pipe(
      catchError(() => this.exchange(sent, ROTATION_GRACE_MS)), // verrou refusé par le navigateur (page sandboxée) : on s'en passe
    );
  }

  private exchange(sent: string, grace: number): Observable<string | null> {
    // Un autre onglet a déjà fait tourner le jeton : le nôtre est consommé, on adopte le sien au lieu de le rejouer.
    const other = this.newerThan(sent);
    if (other) { this.session.set(other); return of(other.accessToken); }
    return this.http.post<AuthResponse>('/api/auth/refresh', { refreshToken: sent }).pipe(
      map(r => this.accept(r)),
      catchError(e => (isRejected(e) ? this.lost(sent, grace) : of(null))),
    );
  }

  /** Un compte qui n'est plus du personnel (rôle retiré pendant la session) n'a plus rien à faire ici : retour à la connexion, avec l'explication. */
  private accept(r: AuthResponse): string | null {
    if (STAFF.includes(r.user.role)) { this.store(r); return r.accessToken; }
    this.revoke(r.refreshToken);
    this.notice.set("Votre rôle a changé : ce compte n'a plus accès au back-office.");
    this.clear();
    return null;
  }

  /** Jeton refusé : soit la session est vraiment finie, soit un autre onglet a gagné la rotation au même instant et son jeton est bon. */
  private lost(sent: string, grace: number): Observable<string | null> {
    return timer(0, 250).pipe(
      take(grace / 250 + 1),
      map(() => this.newerThan(sent)),
      first((s): s is Session => s !== null, null),
      map(winner => {
        if (winner) { this.session.set(winner); return winner.accessToken; }
        this.clear();
        return null;
      }),
    );
  }

  /** Session du stockage si elle n'est plus celle qui porte ce jeton de rafraîchissement. */
  private newerThan(refreshToken: string): Session | null {
    const stored = this.read();
    return stored && stored.refreshToken !== refreshToken ? stored : null;
  }

  private follow(): void {
    const stored = this.read();
    if (stored) {
      this.session.set(stored);
      // Connexion faite dans un autre onglet : le formulaire de celui-ci n'a plus lieu d'être.
      if (this.isStaff() && this.router.url.startsWith('/login')) void this.router.navigate(['/']);
    } else if (this.session()) { this.session.set(null); void this.router.navigate(['/login']); }
  }

  private revoke(refreshToken: string): void {
    this.http.post('/api/auth/logout', { refreshToken }).subscribe({ error: () => undefined });
  }

  private clear(): void {
    try { localStorage.removeItem(SESSION); } catch { /* stockage indisponible */ }
    this.session.set(null);
    void this.router.navigate(['/login']);
  }

  private store(r: AuthResponse): void {
    const s: Session = { accessToken: r.accessToken, refreshToken: r.refreshToken, user: r.user };
    try { localStorage.setItem(SESSION, JSON.stringify(s)); } catch { /* stockage indisponible : la session reste en mémoire */ }
    this.session.set(s);
  }

  private read(): Session | null {
    try {
      const v = JSON.parse(localStorage.getItem(SESSION) ?? 'null') as Session | null;
      return v?.accessToken && v.refreshToken && v.user ? v : null;
    } catch { return null; }
  }
}
