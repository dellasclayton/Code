export type Character = {
  id: string
  name: string
  image: string
  voice: string
  globalPrompt: string
  systemPrompt: string
  inChat?: boolean
}

export type CharacterDraft = {
  id?: string
  name: string
  image: string
  voice: string
  globalPrompt: string
  systemPrompt: string
}
