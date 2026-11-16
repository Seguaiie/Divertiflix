import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { mockApi, PROFILE_ID, renderApp, signIn, USER_ID } from '../test/utils'
import { ProfilesPage } from './ProfilesPage'

const LOCKED_ID = '00000000-0000-4000-8000-0000000000bb'

const profileKey = () => localStorage.getItem(`divertiflix.profile.${USER_ID}`)

beforeEach(() => signIn())

describe('ProfilesPage', () => {
  it('ouvre directement un profil sans code', async () => {
    const user = userEvent.setup()
    mockApi({ '/api/profiles': [{ id: PROFILE_ID, name: 'Camille', hasPin: false }] })
    renderApp(<ProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Regarder en tant que Camille' }))
    expect(profileKey()).toBe(PROFILE_ID)
  })

  it('demande le code avant d\'ouvrir un profil protégé, et affiche une erreur si le code est mauvais', async () => {
    const user = userEvent.setup()
    mockApi({
      '/api/profiles': [{ id: LOCKED_ID, name: 'Ado', hasPin: true, maturityLimit: '13+' }],
      [`POST /api/profiles/${LOCKED_ID}/unlock`]: { status: 403 },
    })
    renderApp(<ProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Regarder en tant que Ado' }))
    const dialog = await screen.findByRole('dialog', { name: 'Code du profil Ado' })
    await user.type(within(dialog).getByLabelText('Code'), '0000')
    await user.click(within(dialog).getByRole('button', { name: 'Continuer' }))

    expect(await within(dialog).findByText('Code incorrect.')).toBeInTheDocument()
    expect(profileKey()).toBe(PROFILE_ID)   // inchangé : signIn() en avait déjà choisi un, le mauvais code ne l'a pas remplacé
  })

  it('ouvre le profil protégé avec le bon code', async () => {
    const user = userEvent.setup()
    mockApi({
      '/api/profiles': [{ id: LOCKED_ID, name: 'Ado', hasPin: true }],
      [`POST /api/profiles/${LOCKED_ID}/unlock`]: { status: 204 },
    })
    renderApp(<ProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Regarder en tant que Ado' }))
    const dialog = await screen.findByRole('dialog', { name: 'Code du profil Ado' })
    await user.type(within(dialog).getByLabelText('Code'), '4242')
    await user.click(within(dialog).getByRole('button', { name: 'Continuer' }))

    await waitFor(() => expect(profileKey()).toBe(LOCKED_ID))
  })

  it('pose un code et une restriction d\'âge depuis la gestion des profils', async () => {
    const user = userEvent.setup()
    const { calls } = mockApi({
      '/api/profiles': [{ id: PROFILE_ID, name: 'Camille', hasPin: false }],
      [`PUT /api/profiles/${PROFILE_ID}/lock`]: { id: PROFILE_ID, name: 'Camille', hasPin: true, maturityLimit: '13+' },
    })
    renderApp(<ProfilesPage />)

    await user.click(await screen.findByRole('button', { name: 'Gérer les profils' }))
    await user.click(await screen.findByRole('button', { name: 'Code et restriction d\'âge du profil Camille' }))
    await user.type(screen.getByLabelText('Code'), '1234')
    await user.selectOptions(screen.getByLabelText('Restriction d\'âge'), '13+')
    await user.click(screen.getByRole('button', { name: 'Enregistrer' }))

    await waitFor(() => expect(calls.some(c => c.method === 'PUT' && c.path === `/api/profiles/${PROFILE_ID}/lock`)).toBe(true))
    const put = calls.find(c => c.path === `/api/profiles/${PROFILE_ID}/lock`)!
    expect(put.body).toEqual({ pin: '1234', maturityLimit: '13+' })
  })
})
