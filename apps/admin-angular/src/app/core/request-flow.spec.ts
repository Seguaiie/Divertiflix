import { ACTION_LABEL, isFinal, NEXT_STATUS } from './request-flow';
import type { RequestStatus } from './models';

const ALL: RequestStatus[] = ['Pending', 'Approved', 'Downloading', 'Available', 'Declined'];

describe('NEXT_STATUS', () => {
  it('couvre tous les états et ne propose jamais de rester sur place', () => {
    for (const s of ALL) {
      expect(NEXT_STATUS[s]).toBeDefined();
      expect(NEXT_STATUS[s]).not.toContain(s);
    }
  });

  it('suit le cycle de vie de la demande, comme l\'API', () => {
    expect(NEXT_STATUS.Pending).toEqual(['Approved', 'Declined']);
    expect(NEXT_STATUS.Approved).toEqual(['Downloading', 'Available', 'Declined']);
    expect(NEXT_STATUS.Downloading).toEqual(['Available', 'Declined']);
  });

  it('« disponible » et « refusée » sont définitifs', () => {
    expect(isFinal('Available')).toBe(true);
    expect(isFinal('Declined')).toBe(true);
    expect(isFinal('Pending')).toBe(false);
  });

  it('chaque état atteignable a un libellé d\'action', () => {
    for (const s of ALL) expect(ACTION_LABEL[s].length).toBeGreaterThan(2);
  });
});
