import { ago } from './format';

describe('ago', () => {
  const now = new Date('2026-10-09T12:00:00Z').getTime();
  const at = (s: number) => new Date(now - s * 1000).toISOString();

  it('exprime les durées récentes en français', () => {
    expect(ago(at(5), now)).toBe('maintenant');
    expect(ago(at(5 * 60), now)).toBe('il y a 5 minutes');
    expect(ago(at(3 * 3600), now)).toBe('il y a 3 heures');
    expect(ago(at(86400), now)).toBe('hier');
  });

  it('repasse à une date au-delà de 30 jours', () => {
    expect(ago(at(60 * 86400), now)).toMatch(/2026|août/);
  });
});
