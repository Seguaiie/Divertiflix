import type { AdminTitle, TitleKind, TitleUpsert } from './models';

export interface TitleFormValue {
  name: string; synopsis: string; kind: TitleKind; genre: string; year: number; durationMinutes: number;
  posterUrl: string; backdropUrl: string; streamUrl: string; author: string; narrator: string;
  director: string; rating: number | null; maturity: string; credits: string; keywords: string; cast: string;
}

/** « a, b ; c » devient ['a', 'b', 'c'] : sans doublon (insensible à la casse), sans vide. */
export function splitList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,;\n]/)) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Formulaire vers charge utile de l'API : les champs vides deviennent null, les listes sont normalisées. */
export function toUpsert(v: TitleFormValue): TitleUpsert {
  const book = v.kind === 'Audiobook';
  return {
    name: v.name.trim(),
    synopsis: v.synopsis.trim(),
    year: v.year,
    kind: v.kind,
    genre: v.genre.trim(),
    durationMinutes: v.durationMinutes,
    posterUrl: orNull(v.posterUrl),
    backdropUrl: orNull(v.backdropUrl),
    streamUrl: orNull(v.streamUrl),
    // L'auteur et le narrateur n'ont de sens que pour un livre audio : on n'enregistre pas de valeurs orphelines.
    author: book ? orNull(v.author) : null,
    narrator: book ? orNull(v.narrator) : null,
    director: book ? null : orNull(v.director),
    rating: v.rating,
    maturity: orNull(v.maturity),
    credits: orNull(v.credits),
    keywords: splitList(v.keywords),
    cast: splitList(v.cast),
  };
}

export function fromTitle(t: AdminTitle | null): TitleFormValue {
  return {
    name: t?.name ?? '', synopsis: t?.synopsis ?? '', kind: t?.kind ?? 'Movie', genre: t?.genre ?? '',
    year: t?.year ?? new Date().getFullYear(), durationMinutes: t?.durationMinutes ?? 90,
    posterUrl: t?.posterUrl ?? '', backdropUrl: t?.backdropUrl ?? '', streamUrl: t?.streamUrl ?? '',
    author: t?.author ?? '', narrator: t?.narrator ?? '', director: t?.director ?? '', rating: t?.rating ?? null,
    maturity: t?.maturity ?? '', credits: t?.credits ?? '', keywords: (t?.keywords ?? []).join(', '), cast: (t?.cast ?? []).join(', '),
  };
}
