import { PaginatorFr } from './paginator-fr';

describe('PaginatorFr', () => {
  const intl = new PaginatorFr();

  it('écrit la plage en français', () => {
    expect(intl.getRangeLabel(0, 12, 27)).toBe('1 à 12 sur 27');
    expect(intl.getRangeLabel(2, 12, 27)).toBe('25 à 27 sur 27');
    expect(intl.getRangeLabel(0, 12, 0)).toBe('0 sur 0');
  });

  it('nomme les boutons en français', () => {
    expect(intl.nextPageLabel).toBe('Page suivante');
    expect(intl.previousPageLabel).toBe('Page précédente');
  });
});
