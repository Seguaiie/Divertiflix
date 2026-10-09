import type { AdminTitle } from './models';
import { fromTitle, splitList, toUpsert, type TitleFormValue } from './title-form';

const base = (over: Partial<TitleFormValue> = {}): TitleFormValue => ({
  ...fromTitle(null), name: '  Spring ', genre: ' Animation ', kind: 'Movie', year: 2019, durationMinutes: 8, ...over,
});

describe('splitList', () => {
  it('sépare par virgule, point-virgule ou saut de ligne, sans vide ni doublon', () => {
    expect(splitList('a, b ; c\nd,, ,')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitList('Ville, ville, VILLE, nuit')).toEqual(['Ville', 'nuit']);
    expect(splitList('   ')).toEqual([]);
  });
});

describe('toUpsert', () => {
  it('nettoie les textes et transforme les champs vides en null', () => {
    const u = toUpsert(base({ posterUrl: '', streamUrl: '  ', credits: '', maturity: '' }));
    expect(u.name).toBe('Spring');
    expect(u.genre).toBe('Animation');
    expect(u.posterUrl).toBeNull();
    expect(u.streamUrl).toBeNull();
    expect(u.credits).toBeNull();
    expect(u.maturity).toBeNull();
  });

  it("n'enregistre l'auteur et le narrateur que pour un livre audio", () => {
    const film = toUpsert(base({ author: 'Voltaire', narrator: 'Camille', director: 'Idris' }));
    expect(film.author).toBeNull();
    expect(film.narrator).toBeNull();
    expect(film.director).toBe('Idris');

    const book = toUpsert(base({ kind: 'Audiobook', author: 'Voltaire', narrator: 'Camille', director: 'Idris' }));
    expect(book.author).toBe('Voltaire');
    expect(book.narrator).toBe('Camille');
    expect(book.director).toBeNull();
  });

  it('normalise les listes', () => {
    const u = toUpsert(base({ keywords: 'mer, solitude, Mer', cast: 'A B; C D' }));
    expect(u.keywords).toEqual(['mer', 'solitude']);
    expect(u.cast).toEqual(['A B', 'C D']);
  });
});

describe('fromTitle', () => {
  it("aller-retour : ce que l'on charge est ce que l'on renvoie", () => {
    const t = {
      id: '1', name: 'Candide', synopsis: 'Conte', year: 1759, kind: 'Audiobook', genre: 'Satire', durationMinutes: 180,
      posterUrl: '/p.webp', backdropUrl: null, streamUrl: 'media:candide/audio.m4a', author: 'Voltaire', narrator: 'Léa', externalSource: 'demo',
      keywords: ['conte', 'satire'], cast: [], director: null, rating: 8.2, maturity: 'TP', addedAt: '2026-01-01T00:00:00Z', isPlayable: true, streamKind: 'Audio', credits: 'Domaine public',
    } as AdminTitle;
    const u = toUpsert(fromTitle(t));
    expect(u).toMatchObject({ name: 'Candide', kind: 'Audiobook', author: 'Voltaire', narrator: 'Léa', streamUrl: 'media:candide/audio.m4a', keywords: ['conte', 'satire'], rating: 8.2, maturity: 'TP', credits: 'Domaine public' });
  });
});
