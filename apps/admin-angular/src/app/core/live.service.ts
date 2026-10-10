import { Injectable, inject, signal } from '@angular/core';
import type * as SignalR from '@microsoft/signalr';
import { AuthService } from './auth.service';

export type LiveKind = 'titleAdded' | 'directorySynced' | 'audiobookshelfSynced' | 'sensorMessage' | 'requestCreated' | 'ticketCreated' | 'ticketReplied';

export interface LiveEvent { id: number; at: Date; kind: LiveKind; text: string }

const MAX_EVENTS = 40;
const RETRY_MS = 2_000;

/**
 * Connexion SignalR vers NotificationsHub pour le personnel : nouvelles demandes et billets, réponses des abonnés,
 * synchronisations AD/Audiobookshelf, nouveaux titres et messages des capteurs (relayés depuis Mosquitto).
 *
 * `tick` augmente à chaque évènement qui change des compteurs ou des listes : les pages le surveillent pour se rafraîchir.
 * La bibliothèque SignalR n'est chargée qu'à la première connexion. Le jeton passe en query string (WebSocket sans en-tête) :
 * il est renouvelé d'avance s'il est périmé, y compris à chaque reconnexion. Une connexion qui échoue au démarrage ou qui
 * abandonne ses reconnexions automatiques est relancée de plus en plus lentement, jusqu'à la déconnexion de l'agent.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly auth = inject(AuthService);
  private connection?: SignalR.HubConnection;
  private seq = 0;
  private wanted = false;
  private retry?: ReturnType<typeof setTimeout>;

  readonly connected = signal(false);
  readonly events = signal<LiveEvent[]>([]);
  readonly tick = signal(0);

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void import('@microsoft/signalr').then(signalR => {
      if (!this.wanted || this.connection) return; // arrêté (ou relancé) pendant le chargement
      const c = new signalR.HubConnectionBuilder()
        .withUrl('/api/hubs/notifications', { accessTokenFactory: () => this.auth.freshAccessToken() })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      this.connection = c;

      c.onreconnected(() => { this.connected.set(true); this.bump(); });
      c.onreconnecting(() => this.connected.set(false));
      c.onclose(() => {
        this.connected.set(false);
        if (this.connection === c) this.retry = setTimeout(() => this.open(c, 1), RETRY_MS);
      });

      c.on('titleAdded', (t: { name: string }) => this.push('titleAdded', `Nouveau titre au catalogue : ${t.name}`, false));
      c.on('requestCreated', (r: { name: string }) => this.push('requestCreated', `Nouvelle demande : ${r.name}`));
      c.on('ticketCreated', (t: { subject: string }) => this.push('ticketCreated', `Nouveau billet : ${t.subject}`));
      c.on('ticketReplied', (t: { subject: string }) => this.push('ticketReplied', `Réponse d'un abonné : ${t.subject}`));
      c.on('directorySynced', (r: { created: number; updated: number; deactivated: number }) =>
        this.push('directorySynced', `Synchro AD : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deactivated} désactivé(s)`));
      c.on('audiobookshelfSynced', (r: { created: number; updated: number }) =>
        this.push('audiobookshelfSynced', `Synchro Audiobookshelf : ${r.created} créé(s), ${r.updated} mis à jour`));
      c.on('sensorMessage', (m: { topic: string; payload: string }) => this.push('sensorMessage', `Capteur [${m.topic}] : ${m.payload}`, false));

      this.open(c);
    });
  }

  /** À la déconnexion : plus aucune écoute, et le fil de l'agent précédent ne reste pas en mémoire. */
  stop(): void {
    this.wanted = false;
    clearTimeout(this.retry);
    const c = this.connection;
    this.connection = undefined;
    this.connected.set(false);
    this.events.set([]);
    if (c) void c.stop();
  }

  /** Démarre la connexion ; un échec (API arrêtée, jeton refusé) la relance plus tard tant que l'agent reste connecté. */
  private open(c: SignalR.HubConnection, attempt = 0): void {
    c.start().then(
      // Après une coupure, des évènements ont pu être manqués : les pages relisent leurs données.
      () => { this.connected.set(true); if (attempt > 0) this.bump(); },
      () => {
        this.connected.set(false);
        if (this.connection === c) this.retry = setTimeout(() => this.open(c, attempt + 1), Math.min(30_000, RETRY_MS * 2 ** attempt));
      },
    );
  }

  private bump(): void { this.tick.update(n => n + 1); }

  private push(kind: LiveKind, text: string, changesData = true): void {
    this.events.update(list => [{ id: ++this.seq, at: new Date(), kind, text }, ...list].slice(0, MAX_EVENTS));
    if (changesData) this.bump();
  }
}
