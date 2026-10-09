export function RowSkeleton({ square = false }: { square?: boolean }) {
  return (
    <section className="row" aria-hidden>
      <div className="row-head"><div className="skeleton" style={{ width: 220, height: 30, borderRadius: 4 }} /></div>
      <div className="row-skeleton">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton" style={square ? { aspectRatio: '1' } : undefined} />)}</div>
    </section>
  )
}

export function GridSkeleton({ n = 12 }: { n?: number }) {
  return <div className="grid" aria-hidden>{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: '2 / 3', borderRadius: 6 }} />)}</div>
}
