import { Link } from 'react-router-dom'
import type { Schemas } from '@divertiflix/api-client'

export function TitleCard({ title }: { title: Schemas['TitleDto'] }) {
  return (
    <Link to={`/titles/${title.id}`} className="card">
      <div className="poster" style={title.posterUrl ? { backgroundImage: `url(${title.posterUrl})` } : undefined}>
        {!title.posterUrl && <span>{title.name.charAt(0)}</span>}
      </div>
      <div className="card-body">
        <strong>{title.name}</strong>
        <small>{title.year} · {title.genre} · {title.durationMinutes} min</small>
      </div>
    </Link>
  )
}
