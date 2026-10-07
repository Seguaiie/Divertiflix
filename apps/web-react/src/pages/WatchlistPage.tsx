import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useAuth } from '../auth'
import { TitleCard } from '../components/TitleCard'

export function WatchlistPage() {
  const { profileId } = useAuth()
  const list = useQuery({
    queryKey: ['watchlist', profileId],
    queryFn: async () => (await api.GET('/api/profiles/{id}/watchlist', { params: { path: { id: profileId! } } })).data ?? [],
  })
  return (
    <>
      <h1>Ma liste</h1>
      {list.data?.length === 0 && <p>Votre liste est vide.</p>}
      <div className="grid">{list.data?.map(t => <TitleCard key={t.id} title={t} />)}</div>
    </>
  )
}
