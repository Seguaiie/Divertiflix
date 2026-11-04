import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, call, type Card, type S } from '../lib/api'
import { useAuth } from './auth'

export type Home = S['HomeDto']
export type Detail = S['TitleDetailDto']

export const keys = {
  home: (p: string) => ['home', p] as const,
  detail: (p: string, id: string) => ['detail', p, id] as const,
  watchlist: (p: string) => ['watchlist', p] as const,
  notifications: ['notifications'] as const,
  status: ['status'] as const,
  genres: (kind: string) => ['genres', kind] as const,
  myRequests: ['requests', 'mine'] as const,
  tickets: ['tickets'] as const,
  mlb: ['mlb', 'results'] as const,
  mlbHighlights: ['mlb', 'highlights'] as const,
  aiNews: ['news', 'ai'] as const,
  aiBenchmarks: ['news', 'ai', 'benchmarks'] as const,
  ticket: (id: string) => ['ticket', id] as const,
}

export function useHome() {
  const { profileId } = useAuth()
  return useQuery({
    queryKey: keys.home(profileId ?? ''),
    enabled: !!profileId,
    staleTime: 60_000,
    queryFn: () => call(api.GET('/api/home', { params: { query: { profileId: profileId! } } })),
  })
}

export function useDetail(id: string | undefined) {
  const { profileId } = useAuth()
  return useQuery({
    queryKey: keys.detail(profileId ?? '', id ?? ''),
    enabled: !!profileId && !!id,
    queryFn: () => call(api.GET('/api/titles/{id}/detail', { params: { path: { id: id! }, query: { profileId: profileId! } } })),
  })
}

export function useWatchlist() {
  const { profileId } = useAuth()
  return useQuery({
    queryKey: keys.watchlist(profileId ?? ''),
    enabled: !!profileId,
    queryFn: () => call(api.GET('/api/profiles/{id}/watchlist', { params: { path: { id: profileId! } } })),
  })
}

type StatePatch = Partial<Pick<Card, 'inWatchlist' | 'myRating'>>

/** Applique un changement d'état (liste, pouce) à toutes les cartes en cache : l'interface répond avant le serveur. */
export function patchTitleState(qc: QueryClient, profileId: string, titleId: string, patch: StatePatch) {
  const fix = (c: Card): Card => (c.title.id === titleId ? { ...c, ...patch } : c)
  qc.setQueryData<Home>(keys.home(profileId), h => h && ({
    ...h,
    hero: h.hero.map(x => ({ ...x, card: fix(x.card) })),
    rows: h.rows.map(r => ({ ...r, items: r.items.map(fix) })),
  }))
  qc.setQueriesData<Detail>({ queryKey: ['detail', profileId] }, d => d && ({ ...d, card: fix(d.card), similar: d.similar.map(fix) }))
  qc.setQueryData<Card[]>(keys.watchlist(profileId), list => list && (patch.inWatchlist === false ? list.filter(c => c.title.id !== titleId) : list.map(fix)))
}

/**
 * À appeler une fois la progression de lecture réellement enregistrée : l'accueil et les fiches la reflètent alors. Une lecture déjà
 * partie (l'accueil se monte au moment où le lecteur envoie sa position) a pu lire l'ancien état : on l'annule avant de relire,
 * car invalider seul laisserait aboutir une première lecture encore sans données.
 */
export async function refreshAfterProgress(qc: QueryClient, profileId: string) {
  for (const queryKey of [keys.home(profileId), ['detail', profileId]]) {
    await qc.cancelQueries({ queryKey })
    void qc.invalidateQueries({ queryKey })
  }
}

function snapshot(qc: QueryClient, profileId: string) {
  return {
    home: qc.getQueryData<Home>(keys.home(profileId)),
    detail: qc.getQueriesData<Detail>({ queryKey: ['detail', profileId] }),
    list: qc.getQueryData<Card[]>(keys.watchlist(profileId)),
  }
}

function restore(qc: QueryClient, profileId: string, s: ReturnType<typeof snapshot>) {
  qc.setQueryData(keys.home(profileId), s.home)
  s.detail.forEach(([k, v]) => qc.setQueryData(k, v))
  qc.setQueryData(keys.watchlist(profileId), s.list)
}

export function useWatchlistToggle() {
  const qc = useQueryClient()
  const { profileId } = useAuth()
  return useMutation({
    mutationFn: async ({ titleId, add }: { titleId: string; add: boolean }) => {
      const params = { params: { path: { id: profileId!, titleId } } }
      await call(add ? api.PUT('/api/profiles/{id}/watchlist/{titleId}', params) : api.DELETE('/api/profiles/{id}/watchlist/{titleId}', params))
    },
    onMutate: ({ titleId, add }) => {
      const snap = snapshot(qc, profileId!)
      patchTitleState(qc, profileId!, titleId, { inWatchlist: add })
      return snap
    },
    onError: (_e, _v, snap) => { if (snap) restore(qc, profileId!, snap) },
    // La promesse est rendue : la mutation reste « en cours » jusqu'à ce que la liste soit relue, sans retour furtif à l'ancien état.
    onSettled: () => qc.invalidateQueries({ queryKey: keys.watchlist(profileId!) }),
  })
}

export function useRate() {
  const qc = useQueryClient()
  const { profileId } = useAuth()
  return useMutation({
    mutationFn: async ({ titleId, value }: { titleId: string; value: -1 | 0 | 1 }) => {
      await call(api.PUT('/api/profiles/{id}/ratings/{titleId}', { params: { path: { id: profileId!, titleId } }, body: { value } }))
    },
    onMutate: ({ titleId, value }) => {
      const snap = snapshot(qc, profileId!)
      patchTitleState(qc, profileId!, titleId, { myRating: value })
      return snap
    },
    onError: (_e, _v, snap) => { if (snap) restore(qc, profileId!, snap) },
    // Un pouce change les recommandations : on rafraîchit l'accueil en arrière-plan, sans le vider.
    onSettled: () => { void qc.invalidateQueries({ queryKey: keys.home(profileId!), refetchType: 'none' }) },
  })
}

export function useClearProgress() {
  const qc = useQueryClient()
  const { profileId } = useAuth()
  return useMutation({
    mutationFn: (titleId: string) => call(api.DELETE('/api/profiles/{id}/progress/{titleId}', { params: { path: { id: profileId!, titleId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.home(profileId!) }),
  })
}

/** Onglet « Domingo » : derniers résultats de la MLB (relayés et mis en cache par l'API). Rafraîchis toutes les 2 min, pour les matchs en cours. */
export function useMlbResults() {
  return useQuery({
    queryKey: keys.mlb,
    queryFn: () => call(api.GET('/api/mlb/results', { params: { query: { days: 7 } } })),
    staleTime: 60_000,
    refetchInterval: 120_000,
  })
}

/** Onglet « Domingo » : derniers faits saillants vidéo de la MLB. */
export function useMlbHighlights() {
  return useQuery({
    queryKey: keys.mlbHighlights,
    queryFn: () => call(api.GET('/api/mlb/highlights', { params: { query: { limit: 16 } } })),
    staleTime: 5 * 60_000,
  })
}

/** Onglet « Nicolas » : nouvelles du jour sur l'IA (rassemblées et mises en cache 15 min par l'API). Relues toutes les 10 min. */
export function useAiNews() {
  return useQuery({
    queryKey: keys.aiNews,
    queryFn: () => call(api.GET('/api/news/ai')),
    staleTime: 5 * 60_000,
    refetchInterval: 10 * 60_000,
  })
}

/** Onglet « Nicolas » : classement des modèles d'IA (Epoch AI, relu par l'API toutes les 6 h). */
export function useAiBenchmarks() {
  return useQuery({
    queryKey: keys.aiBenchmarks,
    queryFn: () => call(api.GET('/api/news/ai/benchmarks')),
    staleTime: 60 * 60_000,
  })
}
