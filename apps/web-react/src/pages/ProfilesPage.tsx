import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'

export function ProfilesPage() {
  const { selectProfile, logout } = useAuth()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const profiles = useQuery({ queryKey: ['profiles'], queryFn: async () => (await api.GET('/api/profiles')).data ?? [] })
  const create = useMutation({
    mutationFn: (n: string) => api.POST('/api/profiles', { body: { name: n } }),
    onSuccess: () => { setName(''); qc.invalidateQueries({ queryKey: ['profiles'] }) },
  })

  return (
    <main className="auth">
      <h1>Qui regarde ?</h1>
      <div className="profiles">
        {profiles.data?.map(p => (
          <button key={p.id} className="profile" onClick={() => selectProfile(p.id)}>
            <span className="avatar">{p.name.charAt(0).toUpperCase()}</span>{p.name}
          </button>
        ))}
      </div>
      {(profiles.data?.length ?? 0) < 5 && (
        <form className="inline" onSubmit={(e: FormEvent) => { e.preventDefault(); if (name.trim()) create.mutate(name.trim()) }}>
          <input placeholder="Nouveau profil" maxLength={50} value={name} onChange={e => setName(e.target.value)} />
          <button>Ajouter</button>
        </form>
      )}
      <button className="link" onClick={logout}>Se déconnecter</button>
    </main>
  )
}
