import { jwtExpiry } from './jwt';

const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('jwtExpiry', () => {
  it('lit la date d\'expiration, y compris en base64url', () => {
    expect(jwtExpiry(`h.${b64url({ exp: 1_800_000_000, name: 'é>?' })}.s`)).toBe(1_800_000_000);
  });

  it('renvoie null pour un jeton illisible ou sans expiration', () => {
    expect(jwtExpiry('pas-un-jwt')).toBeNull();
    expect(jwtExpiry('h.@@@.s')).toBeNull();
    expect(jwtExpiry(`h.${b64url({ sub: '1' })}.s`)).toBeNull();
  });
});
