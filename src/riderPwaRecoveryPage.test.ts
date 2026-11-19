/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../public/auth/actualizar.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
const release = { surface: 'rider', version: '1.0.19', buildId: 'fixture-build' };
const never = () => new Promise(() => {});
function fixture() {
  const nodes = Object.fromEntries(['prepare', 'status', 'release'].map((id) => [id, {
    textContent: '', disabled: false, addEventListener: vi.fn(),
  }]));
  const registration = {
    waiting: {} as unknown, active: {} as unknown, installing: null as unknown,
    update: vi.fn(async () => undefined), unregister: vi.fn(),
  };
  const serviceWorker = { register: vi.fn(async () => registration), getRegistrations: vi.fn() };
  const fetch = vi.fn(async () => ({ ok: true, redirected: false, json: async () => release }));
  const forbidden = new Proxy({}, { get() { throw new Error('Forbidden data access'); } });
  runInNewContext(script, {
    document: { getElementById: (id: string) => nodes[id] }, navigator: { serviceWorker },
    fetch, AbortController, setTimeout, clearTimeout, Date,
    localStorage: forbidden, sessionStorage: forbidden, caches: forbidden,
    location: forbidden,
  });
  const click = nodes.prepare.addEventListener.mock.calls[0][1] as () => Promise<void>;
  return { nodes, registration, serviceWorker, fetch, click };
}
afterEach(() => vi.useRealTimers());

describe('static Rider PWA recovery — offline VM controls', () => {
  it('has no automatic check and prepares only its root registration after verified public release', async () => {
    const f = fixture();
    expect(f.fetch).not.toHaveBeenCalled(); expect(f.serviceWorker.register).not.toHaveBeenCalled();
    await f.click();
    expect(f.fetch).toHaveBeenCalledExactlyOnceWith('/release.json', expect.objectContaining({
      cache: 'no-store', credentials: 'omit', mode: 'same-origin', redirect: 'error',
    }));
    expect(f.serviceWorker.register).toHaveBeenCalledExactlyOnceWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(f.registration.update).toHaveBeenCalledTimes(1);
    expect(f.nodes.release.textContent).toContain('1.0.19 · build fixture-build');
    expect(f.nodes.status.textContent).toContain('en espera, no aplicada');
    expect(f.nodes.prepare.disabled).toBe(false);
    expect(f.registration.unregister).not.toHaveBeenCalled();
    expect(f.serviceWorker.getRegistrations).not.toHaveBeenCalled();
  });
  it.each([
    {}, { ...release, surface: 'customer' }, { ...release, version: 'latest' },
    { ...release, buildId: '<script>' }, { ...release, buildId: '' },
  ])('rejects invalid/non-Rider publication %j before registration', async (data) => {
    const f = fixture(); f.fetch.mockResolvedValue({ ok: true, redirected: false, json: async () => data } as never);
    await f.click(); expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(f.nodes.status.textContent).toContain('No se pudo confirmar');
    expect(f.nodes.release.textContent).not.toContain('verificada:');
    expect(f.nodes.release.textContent).toContain('Publicación no verificada');
  });
  it.each(['offline', 'http', 'redirect', 'json'])('fails closed on release %s', async (failure) => {
    const f = fixture();
    if (failure === 'offline') f.fetch.mockRejectedValue(new Error('offline'));
    else f.fetch.mockResolvedValue({ ok: failure !== 'http', redirected: failure === 'redirect',
      json: async () => { throw new Error('invalid JSON'); } });
    await f.click(); expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(f.nodes.status.textContent).toContain('No continúes');
  });
  it.each(['fetch', 'json', 'register', 'update'])('bounds never-resolving %s and prevents late continuation', async (stage) => {
    vi.useFakeTimers(); const f = fixture();
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    if (stage === 'fetch') f.fetch.mockReturnValue(pending as never);
    if (stage === 'json') f.fetch.mockResolvedValue({ ok: true, redirected: false, json: () => pending } as never);
    if (stage === 'register') f.serviceWorker.register.mockReturnValue(pending as never);
    if (stage === 'update') f.registration.update.mockReturnValue(pending as never);
    const attempt = f.click(); await vi.advanceTimersByTimeAsync(10001); await attempt;
    expect(f.nodes.status.textContent).toContain('tiempo agotado');
    expect(f.nodes.prepare.disabled).toBe(false);
    if (stage === 'fetch' || stage === 'json') expect(f.fetch).toHaveBeenCalledWith('/release.json',
      expect.objectContaining({ signal: expect.objectContaining({ aborted: true }) }));
    const status = f.nodes.status.textContent;
    finish(stage === 'register' ? f.registration : stage === 'fetch'
      ? { ok: true, redirected: false, json: async () => release } : release);
    await vi.advanceTimersByTimeAsync(20000);
    expect(f.nodes.status.textContent).toBe(status);
    if (stage === 'register') expect(f.registration.update).not.toHaveBeenCalled();
    if (stage === 'fetch' || stage === 'json') expect(f.serviceWorker.register).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not stack clicks while a preparation is pending', async () => {
    vi.useFakeTimers(); const f = fixture(); f.fetch.mockImplementation(never as never);
    const attempt = f.click(); await f.click();
    await vi.advanceTimersByTimeAsync(10001); await attempt;
    expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it('does not claim an installed build or a new update for an active worker with no waiting worker', async () => {
    const f = fixture(); f.registration.waiting = null; await f.click();
    expect(f.nodes.status.textContent).toContain('no se detectó una actualización en espera');
    expect(f.nodes.status.textContent).toContain('no se ha verificado su build');
    expect(f.nodes.status.textContent).not.toContain('Preparación confirmada');
  });
  it('bounds unfinished installation without listeners or success claims', async () => {
    vi.useFakeTimers(); const f = fixture(); f.registration.waiting = null; f.registration.installing = {};
    const attempt = f.click(); await vi.advanceTimersByTimeAsync(9000); await attempt;
    expect(f.nodes.status.textContent).toContain('Instalación no confirmada');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('waits for standard installation to reach waiting without activation messages', async () => {
    vi.useFakeTimers(); const f = fixture(); f.registration.waiting = null; f.registration.installing = {};
    const attempt = f.click(); await vi.advanceTimersByTimeAsync(400);
    expect(f.nodes.status.textContent).toContain('no se fuerza');
    f.registration.waiting = {}; f.registration.installing = null;
    await vi.advanceTimersByTimeAsync(200); await attempt;
    expect(f.nodes.status.textContent).toContain('en espera, no aplicada');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows responsive Spanish controls, closure procedure and canonical-domain limits', () => {
    expect(html).toContain('name="viewport"'); expect(html).toContain('aria-live="polite"');
    expect(html).toContain('Preparar actualización'); expect(html).toContain('/piki-mascot-192.png');
    expect(html).toContain('Terminar la entrega y la jornada'); expect(html).toContain('Cerrar TODAS');
    expect(html).toContain('incluidas las pestañas de Chrome'); expect(html).toContain('Abrir de nuevo');
    expect(html).toContain('https://rider.pikidelivery.com/'); expect(html).toContain('NXDOMAIN');
    expect(html).toContain('no puede reparar el dominio'); expect(html).toContain('No necesitas borrar');
    expect(script).not.toMatch(/unregister|caches|SKIP_WAITING|skipWaiting|postMessage|localStorage|sessionStorage|location\.|geolocation|getRegistrations|\/api\//);
    expect(script.match(/addEventListener/g)).toHaveLength(1);
  });
  it('the exact deployed recovery path bypasses the existing worker before respondWith', () => {
    const template = readFileSync(new URL('../public/sw.template.js', import.meta.url), 'utf8');
    const listeners = new Map<string, (event: unknown) => void>();
    const self = { location: { origin: 'https://rider.pikidelivery.com' },
      addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) };
    const source = template.replaceAll('__APP_SHELL__', '[]');
    runInNewContext(source, { self, URL, Set });
    const respondWith = vi.fn();
    listeners.get('fetch')!({ request: new Request('https://rider.pikidelivery.com/auth/actualizar.html'), respondWith });
    expect(respondWith).not.toHaveBeenCalled();
  });
});
