import { Injectable, inject, signal } from '@angular/core';
import type * as SignalR from '@microsoft/signalr';
import { AuthService } from './auth.service';

export type LiveKind = 'titleAdded' | 'directorySynced' | 'audiobookshelfSynced' | 'sensorMessage' | 'requestCreated' | 'ticketCreated' | 'ticketReplied';

export interface LiveEvent { id: number; at: Date; kind: LiveKind; text: string }

const MAX_EVENTS = 40;

/**
 * Connexion SignalR vers NotificationsHub pour le personnel : nouvelles demandes et billets, réponses des abonnés,
 * synchronisations AD/Audiobookshelf, nouveaux titres et messages des capteurs (relayés depuis Mosquitto).
 *
 * `tick` augmente à chaque évènement qui change des compteurs ou des listes : les pages le surveillent pour se rafraîchir.
 * La bibliothèque SignalR n'est chargée qu'à la première connexion. Le jeton passe en query string (WebSocket sans en-tête).
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly auth = inject(AuthService);
  private connection?: SignalR.HubConnection;
  private seq = 0;
  private wanted = false;

  readonly connected = signal(false);
  readonly events = signal<LiveEvent[]>([]);
  readonly tick = signal(0);

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    void import('@microsoft/signalr').then(signalR => {
      if (!this.wanted) return; // arrêté pendant le chargement
      const c = new signalR.HubConnectionBuilder()
        .withUrl('/api/hubs/notifications', { accessTokenFactory: () => this.auth.accessToken ?? '' })
        .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
        .configureLogging(signalR.LogLevel.None)
        .build();
      this.connection = c;

      c.onreconnected(() => { this.connected.set(true); this.bump(); });
      c.onreconnecting(() => this.connected.set(false));
      c.onclose(() => this.connected.set(false));

      c.on('titleAdded', (t: { name: string }) => this.push('titleAdded', `Nouveau titre au catalogue : ${t.name}`, false));
      c.on('requestCreated', (r: { name: string }) => this.push('requestCreated', `Nouvelle demande : ${r.name}`));
      c.on('ticketCreated', (t: { subject: string }) => this.push('ticketCreated', `Nouveau billet : ${t.subject}`));
      c.on('ticketReplied', (t: { subject: string }) => this.push('ticketReplied', `Réponse d'un abonné : ${t.subject}`));
      c.on('directorySynced', (r: { created: number; updated: number; deactivated: number }) =>
        this.push('directorySynced', `Synchro AD : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deactivated} désactivé(s)`));
      c.on('audiobookshelfSynced', (r: { created: number; updated: number }) =>
        this.push('audiobookshelfSynced', `Synchro Audiobookshelf : ${r.created} créé(s), ${r.updated} mis à jour`));
      c.on('sensorMessage', (m: { topic: string; payload: string }) => this.push('sensorMessage', `Capteur [${m.topic}] : ${m.payload}`, false));

      c.start().then(() => this.connected.set(true)).catch(() => this.connected.set(false));
    });
  }

  /** À la déconnexion : plus aucune écoute, et le fil de l'agent précédent ne reste pas en mémoire. */
  stop(): void {
    this.wanted = false;
    const c = this.connection;
    this.connection = undefined;
    this.connected.set(false);
    this.events.set([]);
    if (c) void c.stop();
  }

  private bump(): void { this.tick.update(n => n + 1); }

  private push(kind: LiveKind, text: string, changesData = true): void {
    this.events.update(list => [{ id: ++this.seq, at: new Date(), kind, text }, ...list].slice(0, MAX_EVENTS));
    if (changesData) this.bump();
  }
}
