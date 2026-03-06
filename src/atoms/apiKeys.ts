import { atom } from 'jotai'

export const connectedProvidersAtom = atom<string[]>([])
export const apiKeysLoadingAtom = atom<boolean>(false)
