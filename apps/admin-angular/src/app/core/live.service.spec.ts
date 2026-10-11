import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LiveService } from './live.service';

// Fausse bibliothèque SignalR : on garde chaque connexion construite pour piloter ses démarrages, ses fermetures et ses évènements.
interface FakeConnection {
  start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; token: () => unknown; close: () => void; emit: (name: string, payload: unknown) => void;
}
const hub = vi.hoisted(() => ({ made: [] as FakeConnection[], script: [] as ('fail' | 'ok')[] }));

vi.mock('@microsoft/signalr', () => {
  class HubConnectionBuilder {
    private factory: () => unknown = () => '';
    withUrl(_url: string, o: { accessTokenFactory: () => unknown }) { this.factory = o.accessTokenFactory; return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() {
      let onClose = () => undefined as void;
      const handlers = new Map<string, (payload: unknown) => void>();
      const c = {
        start: vi.fn(() => (hub.script.shift() === 'fail' ? Promise.reject(new Error('négociation refusée')) : Promise.resolve())),
        // Comme la vraie bibliothèque : arrêter la connexion déclenche son gestionnaire `onclose`.
        stop: vi.fn(() => { onClose(); return Promise.resolve(); }),
        token: this.factory,
        close: () => onClose(),
        emit: (name: string, payload: unknown) => handlers.get(name)?.(payload),
        on: vi.fn((name: string, h: (payload: unknown) => void) => { handlers.set(name, h); }),
        onreconnected: vi.fn(), onreconnecting: vi.fn(), onclose: (h: () => void) => { onClose = h; },
      };
      hub.made.push(c);
      return c;
    }
  }
  return { HubConnectionBuilder, LogLevel: { None: 6 } };
});

const flush = async () => { await vi.dynamicImportSettled(); for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('LiveService', () => {
  beforeEach(() => {
    hub.made.length = 0;
    hub.script.length = 0;
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('se connecte et affiche « En direct »', async () => {
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    expect(hub.made).toHaveLength(1);
    expect(live.connected()).toBe(true);
    expect(live.tick()).toBe(0);
  });

  it('un démarrage qui échoue (API arrêtée) est relancé, puis les pages relisent leurs données', async () => {
    hub.script.push('fail');
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    expect(live.connected()).toBe(false);
    expect(hub.made[0].start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(2);
    expect(live.connected()).toBe(true);
    expect(live.tick()).toBe(1);
  });

  it('les tentatives ralentissent, et la déconnexion les arrête', async () => {
    hub.script.push('fail', 'fail', 'fail');
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    await vi.advanceTimersByTimeAsync(2000); // 2e essai
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000); // le 3e attend 4 s : pas encore
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(2);

    live.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(2);
    expect(hub.made[0].stop).toHaveBeenCalled();
    expect(live.connected()).toBe(false);
  });

  it('après la déconnexion, plus aucun démarrage même longtemps après (la fermeture que provoque stop() ne relance pas)', async () => {
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(1);

    live.stop();
    await flush();
    expect(hub.made[0].stop).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(120_000);
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(1);
    expect(hub.made).toHaveLength(1);
    expect(live.connected()).toBe(false);
  });

  it('une déconnexion pendant le chargement de la bibliothèque ne laisse aucune connexion', async () => {
    const live = TestBed.inject(LiveService);
    live.start();
    live.stop();
    await flush();
    expect(hub.made).toHaveLength(0);
    expect(live.connected()).toBe(false);
  });

  it('les évènements s\'accumulent, les compteurs des pages sont avertis, et la déconnexion vide le fil de l\'agent', async () => {
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    hub.made[0].emit('requestCreated', { name: 'Nosferatu' });
    hub.made[0].emit('titleAdded', { name: 'Metropolis' }); // informatif : n'invite pas les pages à se relire
    expect(live.events().map(e => e.text)).toEqual(['Nouveau titre au catalogue : Metropolis', 'Nouvelle demande : Nosferatu']);
    expect(live.tick()).toBe(1);

    live.stop();
    expect(live.events()).toEqual([]); // l'agent suivant ne voit pas le fil du précédent
  });

  it('une connexion qui abandonne ses reconnexions automatiques est relancée', async () => {
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    hub.made[0].close();
    expect(live.connected()).toBe(false);

    await vi.advanceTimersByTimeAsync(2000);
    await flush();
    expect(hub.made[0].start).toHaveBeenCalledTimes(2);
    expect(live.connected()).toBe(true);
  });

  it('présente un jeton renouvelé d\'avance quand il est périmé', async () => {
    const expired = `h.${btoa(JSON.stringify({ exp: Date.now() / 1000 - 60 }))}.s`;
    localStorage.setItem('divertiflix.admin.session', JSON.stringify({ accessToken: expired, refreshToken: 'RT', user: { id: '1', email: 'root', role: 'Admin' } }));
    const live = TestBed.inject(LiveService);
    live.start();
    await flush();
    const token = hub.made[0].token() as Promise<string>;
    TestBed.inject(HttpTestingController).expectOne('/api/auth/refresh')
      .flush({ accessToken: 'AT2', refreshToken: 'RT2', user: { id: '1', email: 'root', role: 'Admin' } });
    await expect(token).resolves.toBe('AT2');
  });
});
