import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, renderApp, signIn } from '../test/utils'
import { MlbHighlights } from './MlbHighlights'

const clip = (n: number, title: string) => ({
  id: `c${n}`, title, description: `Description ${n}`, durationSeconds: 448, date: '2026-10-29T05:08:26Z',
  videoUrl: `https://mlb-cuts-diamond.mlb.com/FORGE/c${n}_1280x720.mp4`, posterUrl: `https://img.mlbstatic.com/mlb-images/image/upload/w_1920,h_1080,f_jpg/c${n}.jpg`,
  matchup: 'MIL @ TB', gameId: 1,
})
const clips = [clip(1, 'Brewers vs. Rays Game 5 Highlights'), clip(2, 'Condensed Game: MIL@TB'), clip(3, 'The Brewers are World Series Champions!')]

let play: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  signIn()
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})

const source = () => document.querySelector('video source')?.getAttribute('src')

describe('lecteur des faits saillants MLB', () => {
  it('charge le premier clip sans le lancer, puis lit celui que l\'on choisit et enchaîne le suivant à la fin', async () => {
    mockApi({ '/api/mlb/highlights': clips })
    renderApp(<MlbHighlights />)

    expect(await screen.findByRole('heading', { level: 3, name: 'Brewers vs. Rays Game 5 Highlights' })).toBeInTheDocument()
    expect(source()).toBe(clips[0]!.videoUrl)
    expect(document.querySelector('video')?.getAttribute('poster')).toBe(clips[0]!.posterUrl)
    expect(play).not.toHaveBeenCalled()   // pas de son tout seul à l'arrivée sur la page

    const list = screen.getByRole('list')
    expect(within(list).getAllByRole('button')).toHaveLength(3)
    // Vignettes en petite taille dans la liste.
    expect(list.querySelector('img')?.getAttribute('src')).toContain('w_320,h_180')

    await userEvent.click(within(list).getByRole('button', { name: /Condensed Game/ }))
    expect(source()).toBe(clips[1]!.videoUrl)
    expect(within(list).getByRole('button', { name: /Condensed Game/ })).toHaveAttribute('aria-current', 'true')
    expect(play).toHaveBeenCalled()

    fireEvent.ended(document.querySelector('video')!)
    expect(source()).toBe(clips[2]!.videoUrl)
  })

  it('dit simplement quand la MLB ne fournit pas de vidéo', async () => {
    mockApi({ '/api/mlb/highlights': { status: 502, body: { title: 'Bad Gateway', status: 502 } } })
    renderApp(<MlbHighlights />)
    expect(await screen.findByText('Les vidéos de la MLB sont indisponibles pour le moment.')).toBeInTheDocument()
  })
})
