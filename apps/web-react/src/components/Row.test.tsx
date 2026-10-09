import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockApi, renderApp } from '../test/utils'
import { Row } from './Row'

describe('Row', () => {
  it('est une région nommée avec ses flèches', () => {
    mockApi({})
    renderApp(<Row title="Tendances"><a className="card-link" href="#a">A</a></Row>)
    expect(screen.getByRole('region', { name: 'Tendances' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Tendances' })).toBeInTheDocument()
  })

  it('les flèches gauche et droite déplacent le focus entre les cartes', async () => {
    mockApi({})
    const user = userEvent.setup()
    renderApp(<Row title="Tendances"><a className="card-link" href="#a">A</a><a className="card-link" href="#b">B</a><a className="card-link" href="#c">C</a></Row>)
    screen.getByText('A').focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByText('B')).toHaveFocus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByText('C')).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByText('B')).toHaveFocus()
  })
})
