import { reset } from '../src/index'

const SEEN = 'divertiflix.demo.hint'

/** Pastille « Démo » (bas gauche) et bandeau d'aide à la première visite. DOM direct : l'application elle-même n'est pas modifiée. */
export function mountDemoBar(opts: { other: { label: string; href: string }; hint: string }): void {
  const bar = document.createElement('div')
  bar.className = 'demo-bar'
  bar.innerHTML = `<span class="demo-tag">Démo</span><a class="demo-link" target="_blank" rel="noopener"></a><button class="demo-link" type="button">Réinitialiser</button>`
  const a = bar.querySelector('a')!
  a.textContent = opts.other.label
  a.href = opts.other.href
  bar.querySelector('button')!.addEventListener('click', () => { reset(); location.reload() })
  document.body.append(bar)

  let seen = false
  try { seen = sessionStorage.getItem(SEEN) === '1' } catch { /* stockage indisponible */ }
  if (seen) return
  const hint = document.createElement('div')
  hint.className = 'demo-hint'
  hint.setAttribute('role', 'note')
  hint.innerHTML = `<p></p><button type="button" aria-label="Fermer">OK</button>`
  hint.querySelector('p')!.textContent = opts.hint
  const close = () => { hint.remove(); document.removeEventListener('pointerdown', onAway); try { sessionStorage.setItem(SEEN, '1') } catch { /* rien */ } }
  const onAway = (e: Event) => { if (!hint.contains(e.target as Node)) close() }
  hint.querySelector('button')!.addEventListener('click', close)
  document.body.append(hint)
  setTimeout(() => document.addEventListener('pointerdown', onAway), 1500)   // la connexion elle-même ne la ferme pas par accident
  setTimeout(close, 14000)
}
