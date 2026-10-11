import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef, useState } from 'react'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { useDialog } from './useDialog'

function Box({ label, open, onClose }: { label: string; open: boolean; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDialog(open, onClose, ref)
  return open ? <div role="dialog" aria-modal="true" aria-label={label} ref={ref}><button>{label} un</button><button>{label} deux</button></div> : null
}

/** Deux dialogues indépendants ; la touche X ferme A où que soit le focus, comme Ctrl+J ferme l'assistant sous une fiche. */
function Stage() {
  const [a, setA] = useState(false)
  const [b, setB] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === 'x') setA(false) }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  return (
    <>
      <button onClick={() => setA(true)}>ouvrir A</button>
      <button onClick={() => setB(true)}>ouvrir B</button>
      <Box label="A" open={a} onClose={() => setA(false)} />
      <Box label="B" open={b} onClose={() => setB(false)} />
    </>
  )
}

const dialogs = () => screen.queryAllByRole('dialog').map(d => d.getAttribute('aria-label'))
const flush = () => new Promise<void>(r => queueMicrotask(r)) // le focus initial est posé dans une microtâche

// jsdom ne fait pas de mise en page : offsetParent y est toujours nul, ce qui viderait la liste des éléments atteignables au clavier.
const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent')
beforeAll(() => Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.parentNode } }))
afterAll(() => { if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent) })

describe('useDialog', () => {
  it('Échap ne ferme que le dialogue du dessus', async () => {
    const user = userEvent.setup()
    render(<Stage />)
    await user.click(screen.getByRole('button', { name: 'ouvrir A' }))
    await user.click(screen.getByRole('button', { name: 'ouvrir B' }))
    expect(dialogs()).toEqual(['A', 'B'])

    await user.keyboard('{Escape}')
    expect(dialogs()).toEqual(['A'])
    await user.keyboard('{Escape}')
    expect(dialogs()).toEqual([])
  })

  it('le défilement du fond reste bloqué tant qu\'un dialogue est ouvert, même fermés dans le désordre', async () => {
    const user = userEvent.setup()
    render(<Stage />)
    await user.click(screen.getByRole('button', { name: 'ouvrir A' }))
    await user.click(screen.getByRole('button', { name: 'ouvrir B' }))
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('x') // A se ferme sous B
    expect(dialogs()).toEqual(['B'])
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('')
  })

  it('le focus entre dans le dialogue et revient au déclencheur à la fermeture', async () => {
    const user = userEvent.setup()
    render(<Stage />)
    const opener = screen.getByRole('button', { name: 'ouvrir A' })
    await user.click(opener)
    await flush()
    expect(screen.getByRole('button', { name: 'A un' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
  })

  it('un dialogue fermé sous un autre ne lui vole pas le focus', async () => {
    const user = userEvent.setup()
    render(<Stage />)
    await user.click(screen.getByRole('button', { name: 'ouvrir A' }))
    await user.click(screen.getByRole('button', { name: 'ouvrir B' }))
    await flush()
    expect(screen.getByRole('button', { name: 'B un' })).toHaveFocus()

    await user.keyboard('x')
    expect(dialogs()).toEqual(['B'])
    expect(screen.getByRole('button', { name: 'B un' })).toHaveFocus()
  })

  it('si le déclencheur du dernier dialogue a disparu (fiche remplacée), le focus revient à celui du premier', async () => {
    function Dialog({ label, onClose, children }: { label: string; onClose(): void; children?: React.ReactNode }) {
      const ref = useRef<HTMLDivElement>(null)
      useDialog(true, onClose, ref)
      return <div role="dialog" aria-modal="true" aria-label={label} ref={ref}><button>{label} un</button>{children}</div>
    }
    // Une fiche A, l'assistant Z ouvert depuis elle, puis « Détails » dans Z : A est remplacée par B sous Z, et le bouton qui avait ouvert Z disparaît avec A.
    function Scene() {
      const [sheet, setSheet] = useState<'A' | 'B' | null>(null)
      const [z, setZ] = useState(false)
      return (
        <>
          <button onClick={() => setSheet('A')}>ouvrir A</button>
          {sheet && <Dialog key={sheet} label={sheet} onClose={() => setSheet(null)}>{sheet === 'A' && <button onClick={() => setZ(true)}>ouvrir Z</button>}</Dialog>}
          {z && <Dialog label="Z" onClose={() => setZ(false)}><button onClick={() => setSheet('B')}>détails B</button></Dialog>}
        </>
      )
    }
    const user = userEvent.setup()
    render(<Scene />)
    const opener = screen.getByRole('button', { name: 'ouvrir A' })
    await user.click(opener)
    await user.click(screen.getByRole('button', { name: 'ouvrir Z' }))
    await user.click(screen.getByRole('button', { name: 'détails B' }))
    await flush()
    expect(dialogs()).toEqual(['B', 'Z']) // dans l'ordre du document ; B, ouvert en dernier, est au-dessus

    await user.keyboard('{Escape}') // B se ferme : le focus revient au bouton de Z, qui existe encore
    expect(dialogs()).toEqual(['Z'])
    expect(screen.getByRole('button', { name: 'détails B' })).toHaveFocus()

    await user.keyboard('{Escape}') // Z se ferme : « ouvrir Z » a disparu avec A, le focus revient à « ouvrir A » et non à <body>
    expect(dialogs()).toEqual([])
    expect(opener).toHaveFocus()
  })

  it('Tab et Maj+Tab bouclent dans le dialogue', async () => {
    const user = userEvent.setup()
    render(<Stage />)
    await user.click(screen.getByRole('button', { name: 'ouvrir A' }))
    await flush()
    const [first, last] = [screen.getByRole('button', { name: 'A un' }), screen.getByRole('button', { name: 'A deux' })]

    await user.tab()
    expect(last).toHaveFocus()
    await user.tab()
    expect(first).toHaveFocus()
    await user.tab({ shift: true })
    expect(last).toHaveFocus()
  })
})
