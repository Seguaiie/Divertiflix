import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/utils'
import { NotFoundPage } from './NotFoundPage'

describe('NotFoundPage', () => {
  it('le titre de la page est le titre de niveau 1, avec un lien de retour à l\'accueil', () => {
    renderApp(<NotFoundPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Page introuvable' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', '/')
  })
})
