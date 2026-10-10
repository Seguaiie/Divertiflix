import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LiveService } from './live.service';

// Fausse bibliothèque SignalR : on garde chaque connexion construite pour piloter ses démarrages et ses fermetures.
interface FakeConnection { start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; token: () => unknown; close: () => void }
const hub = vi.hoisted(() => ({ made: [] as FakeConnection[], script: [] as ('fail' | 'ok')[] }));

vi.mock('@microsoft/signalr', () => {
  class HubConnectionBuilder {
    private factory: () => unknown = () => '';
    withUrl(_url: string, o: { accessTokenFactory: () => unknown }) { this.factory = o.accessTokenFactory; return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() {
      let onClose = () => undefined as void;
      const c = {
        start: vi.fn(() => (hub.script.shift() === 'fail' ? Promise.reject(new Error('négociation refusée')) : Promise.resolve())),
        stop: vi.fn(() => Promise.resolve()),
        token: this.factory,
        close: () => onClose(),
        on: vi.fn(), onreconnected: vi.fn(), onreconnecting: vi.fn(), onclose: (h: () => void) => { onClose = h; },
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
