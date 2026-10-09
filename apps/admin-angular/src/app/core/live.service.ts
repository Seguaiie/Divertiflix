import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { AuthService } from './auth.service';

export interface LiveEvent {
  at: Date;
  kind: 'titleAdded' | 'directorySynced' | 'audiobookshelfSynced' | 'sensorMessage';
  text: string;
}

const MAX_EVENTS = 30;

/**
 * Connexion SignalR vers NotificationsHub (étape 4, plan.md) : nouveaux titres, synchros
 * AD/Audiobookshelf (points 6-7), messages capteurs ESP32 relayés depuis Mosquitto par
 * MqttBridgeService. Le jeton passe en query string (WithUrl) : un WebSocket ne peut pas
 * poser d'en-tête Authorization.
 */
@Injectable({ providedIn: 'root' })
export class LiveService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private connection?: signalR.HubConnection;

  readonly connected = signal(false);
  readonly events = signal<LiveEvent[]>([]);

  connect(): void {
    if (this.connection) return;
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl('/api/hubs/notifications', { accessTokenFactory: () => this.auth.accessToken ?? '' })
      .withAutomaticReconnect()
      .build();

    this.connection.onreconnected(() => this.connected.set(true));
    this.connection.onclose(() => this.connected.set(false));

    this.connection.on('titleAdded', (t: { name: string }) =>
      this.push('titleAdded', `Nouveau titre au catalogue : ${t.name}`));
    this.connection.on('directorySynced', (r: { created: number; updated: number; deactivated: number }) =>
      this.push('directorySynced', `Synchro AD : ${r.created} créé(s), ${r.updated} mis à jour, ${r.deactivated} désactivé(s)`));
    this.connection.on('audiobookshelfSynced', (r: { created: number; updated: number }) =>
      this.push('audiobookshelfSynced', `Synchro Audiobookshelf : ${r.created} créé(s), ${r.updated} mis à jour`));
    this.connection.on('sensorMessage', (m: { topic: string; payload: string }) =>
      this.push('sensorMessage', `Capteur [${m.topic}] : ${m.payload}`));

    this.connection.start().then(() => this.connected.set(true)).catch(() => this.connected.set(false));
  }

  private push(kind: LiveEvent['kind'], text: string): void {
    this.events.update(list => [{ at: new Date(), kind, text }, ...list].slice(0, MAX_EVENTS));
  }

  ngOnDestroy(): void {
    void this.connection?.stop();
  }
}
