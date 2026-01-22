import type { ChangeEvent, KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Brain,
  FileText,
  MessageCircle,
  Plus,
  User,
  Users,
} from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

type Character = {
  id: string
  name: string
  image: string
  voice: string
  globalPrompt: string
  systemPrompt: string
  inChat?: boolean
}

type CharacterDraft = {
  id?: string
  name: string
  image: string
  voice: string
  globalPrompt: string
  systemPrompt: string
}

const voiceOptions = ['lydia', 'nova', 'atlas', 'rhea', 'sage', 'ember']

const emptyDraft: CharacterDraft = {
  name: '',
  image: '',
  voice: '',
  globalPrompt: '',
  systemPrompt: '',
}

const storageKey = 'bosun.characters'

const readCharacters = () => {
  if (typeof window === 'undefined') {
    return []
  }

  const stored = window.localStorage.getItem(storageKey)
  if (!stored) {
    return []
  }

  try {
    const parsed = JSON.parse(stored)
    return Array.isArray(parsed) ? (parsed as Character[]) : []
  } catch {
    return []
  }
}

const writeCharacters = (items: Character[]) => {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, JSON.stringify(items))
}

const createCharacterId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const toDraft = (character?: Character): CharacterDraft =>
  character
    ? {
        id: character.id,
        name: character.name,
        image: character.image,
        voice: character.voice,
        globalPrompt: character.globalPrompt,
        systemPrompt: character.systemPrompt,
      }
    : { ...emptyDraft }

type TabPlaceholderProps = {
  icon: LucideIcon
  title: string
}

function TabPlaceholder({ icon: Icon, title }: TabPlaceholderProps) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-6">
      <div className="flex flex-col items-center gap-2 text-sm text-[#8b929b]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#2a2f36] bg-[#171a1f]">
          <Icon className="h-6 w-6" />
        </div>
        <div className="text-sm font-semibold text-[#dfe3e8]">{title}</div>
        <div className="text-xs text-[#7b838d]">Coming soon</div>
      </div>
    </div>
  )
}

function CharactersPage() {
  const [characters, setCharacters] = useState<Character[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draft, setDraft] = useState<CharacterDraft>({ ...emptyDraft })

  useEffect(() => {
    setCharacters(readCharacters())
  }, [])

  const handleOpenCharacter = (character: Character) => {
    setDraft(toDraft(character))
    setDialogOpen(true)
  }

  const handleNewCharacter = () => {
    setDraft({ ...emptyDraft })
    setDialogOpen(true)
  }

  const handleCardKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    character: Character
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      handleOpenCharacter(character)
    }
  }

  const handleFieldChange = (
    key: keyof CharacterDraft,
    value: string
  ) => {
    setDraft((prev) => ({ ...prev, [key]: value }))
  }

  const handleImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const input = event.target
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      setDraft((prev) => ({ ...prev, image: result }))
      input.value = ''
    }
    reader.readAsDataURL(file)
  }

  const handleSave = () => {
    const id = draft.id ?? createCharacterId()
    const existing = characters.find((character) => character.id === id)
    const record: Character = {
      id,
      name: draft.name.trim(),
      image: draft.image,
      voice: draft.voice,
      globalPrompt: draft.globalPrompt,
      systemPrompt: draft.systemPrompt,
      inChat: existing?.inChat ?? false,
    }

    setCharacters((prev) => {
      const next = prev.some((character) => character.id === id)
        ? prev.map((character) => (character.id === id ? record : character))
        : [record, ...prev]
      writeCharacters(next)
      return next
    })

    setDialogOpen(false)
  }

  const handleDelete = () => {
    if (!draft.id) {
      setDialogOpen(false)
      return
    }

    setCharacters((prev) => {
      const next = prev.filter((character) => character.id !== draft.id)
      writeCharacters(next)
      return next
    })

    setDialogOpen(false)
  }

  const headerName = draft.name.trim() || 'Character name'
  const fileInputId = `character-image-${draft.id ?? 'new'}`

  return (
    <div className="flex h-full w-full flex-col gap-6 overflow-hidden p-6 lg:flex-row">
      <div className="flex w-full flex-col gap-6 lg:w-[30%] lg:min-w-[220px] lg:max-w-[320px]">
        <div className="rounded-2xl border border-[#2d3138] bg-[#171a1f] p-5 shadow-[0_20px_45px_rgba(0,0,0,0.35)]">
          <Button
            type="button"
            onClick={handleNewCharacter}
            className={cn(
              'w-full justify-center gap-2 rounded-xl bg-[#0f7cc4] text-white shadow-[0_12px_30px_rgba(15,124,196,0.35)]',
              'hover:bg-[#1692df]'
            )}
          >
            <Plus className="h-4 w-4" />
            New Character
          </Button>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <ScrollArea className="flex-1 min-h-0">
          <div className="grid grid-cols-2 gap-4 p-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {characters.map((character) => {
              const cardName = character.name.trim() || 'Character name'
              return (
                <div
                  key={character.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${cardName} details`}
                  onClick={() => handleOpenCharacter(character)}
                  onKeyDown={(event) => handleCardKeyDown(event, character)}
                  className={cn(
                    'group relative overflow-hidden rounded-3xl border border-[#2f353d] bg-[#111316] text-left',
                    'shadow-[0_18px_40px_rgba(0,0,0,0.35)] transition-all duration-300',
                    'hover:-translate-y-1 hover:border-[#3a4048]'
                  )}
                >
                  <div className="relative aspect-[3/4] w-full">
                    {character.image ? (
                      <img
                        src={character.image}
                        alt={cardName}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#15181c]">
                        <User className="h-12 w-12 text-[#6c7480]" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0d0f12]/90 via-[#0d0f12]/30 to-transparent" />
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 p-4">
                    <div className="text-base font-semibold text-white">
                      {cardName}
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'h-2.5 w-2.5 rounded-full border',
                          character.inChat
                            ? 'border-emerald-200 bg-emerald-400'
                            : 'border-[#4a515c] bg-[#2a2e34]'
                        )}
                        aria-label={
                          character.inChat ? 'In chat' : 'Not in chat'
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(event) => event.stopPropagation()}
                        className={cn(
                          'h-8 rounded-full border-[#3a4048] bg-[#15181c]/70 px-3 text-xs text-[#dbe1e8]',
                          'hover:bg-[#1e2228] hover:text-white'
                        )}
                      >
                        <MessageCircle className="h-3.5 w-3.5 text-[#6cc5ff]" />
                        Chat
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) {
            setDraft({ ...emptyDraft })
          }
        }}
      >
        <DialogContent
          className={cn(
            'flex min-h-0 flex-col h-[min(900px,92vh)] w-[min(1400px,96vw)] max-w-[min(1400px,96vw)] sm:max-w-[min(1400px,96vw)] overflow-hidden border-[#2d3138] bg-[#1b1e23] p-0 text-[#e3e7ec]',
            'shadow-[0_30px_90px_rgba(0,0,0,0.6)]'
          )}
        >
          <DialogDescription className="sr-only">
            Manage character profile settings and prompts.
          </DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-4 border-b border-[#2a2f36] px-6 py-4">
              <Avatar className="size-12 border border-[#353b44]">
                <AvatarImage src={draft.image || undefined} alt={headerName} />
                <AvatarFallback className="bg-[#23272f] text-[#cfd5dd]">
                  <User className="h-5 w-5" />
                </AvatarFallback>
              </Avatar>
              <DialogTitle className="text-lg font-semibold text-white">
                {headerName}
              </DialogTitle>
            </div>

            <Tabs
              defaultValue="profile"
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <TabsList className="h-auto w-full justify-start gap-8 rounded-none border-b border-[#2a2f36] bg-transparent px-6 py-0">
                <TabsTrigger
                  value="profile"
                  className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm text-[#9aa2ad] shadow-none data-[state=active]:border-[#0f7cc4] data-[state=active]:bg-transparent data-[state=active]:text-white"
                >
                  Profile
                </TabsTrigger>
                <TabsTrigger
                  value="background"
                  className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm text-[#9aa2ad] shadow-none data-[state=active]:border-[#0f7cc4] data-[state=active]:bg-transparent data-[state=active]:text-white"
                >
                  Background
                </TabsTrigger>
                <TabsTrigger
                  value="chats"
                  className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm text-[#9aa2ad] shadow-none data-[state=active]:border-[#0f7cc4] data-[state=active]:bg-transparent data-[state=active]:text-white"
                >
                  Chats
                </TabsTrigger>
                <TabsTrigger
                  value="groups"
                  className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm text-[#9aa2ad] shadow-none data-[state=active]:border-[#0f7cc4] data-[state=active]:bg-transparent data-[state=active]:text-white"
                >
                  Groups
                </TabsTrigger>
                <TabsTrigger
                  value="memory"
                  className="h-auto flex-none rounded-none border-0 border-b-2 border-transparent bg-transparent px-0 py-3 text-sm text-[#9aa2ad] shadow-none data-[state=active]:border-[#0f7cc4] data-[state=active]:bg-transparent data-[state=active]:text-white"
                >
                  Memory
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="profile"
                className="flex-1 min-h-0 overflow-hidden"
              >
                <div className="flex h-full min-h-0 flex-col lg:flex-row">
                  <div className="flex w-full flex-col bg-[#191b1f] p-6 lg:w-[40%] lg:min-w-[320px] lg:max-w-[560px] lg:border-r lg:border-[#2a2f36]">
                    <label
                      htmlFor={fileInputId}
                      className={cn(
                        'relative flex flex-1 min-h-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl',
                        'border border-dashed border-[#2a2f36] bg-[#111316] text-center'
                      )}
                    >
                      {draft.image ? (
                        <img
                          src={draft.image}
                          alt={headerName}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                          <User className="h-10 w-10 text-[#6c7480]" />
                          <span className="text-sm text-[#6cc5ff]">
                            Click to upload image
                          </span>
                        </div>
                      )}
                    </label>
                    <input
                      id={fileInputId}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleImageChange}
                    />
                  </div>

                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="flex-1 overflow-y-auto p-6">
                      <div className="space-y-5">
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b929b]">
                            Global Roleplay System Prompt
                          </Label>
                          <Textarea
                            value={draft.globalPrompt}
                            onChange={(event) =>
                              handleFieldChange(
                                'globalPrompt',
                                event.target.value
                              )
                            }
                            placeholder="Enter global roleplay system prompt"
                            className="min-h-[100px] border-[#2c323a] bg-[#15181c] text-sm text-[#dfe3e8]"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b929b]">
                            Character Name
                          </Label>
                          <Input
                            value={draft.name}
                            onChange={(event) =>
                              handleFieldChange('name', event.target.value)
                            }
                            placeholder="Character name"
                            className="border-[#2c323a] bg-[#15181c] text-sm text-[#dfe3e8]"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b929b]">
                            Voice
                          </Label>
                          <Select
                            value={draft.voice || undefined}
                            onValueChange={(value) =>
                              handleFieldChange('voice', value)
                            }
                          >
                            <SelectTrigger className="w-full border-[#2c323a] bg-[#15181c] text-sm text-[#dfe3e8]">
                              <SelectValue placeholder="Select voice" />
                            </SelectTrigger>
                            <SelectContent className="border-[#2c323a] bg-[#15181c] text-[#dfe3e8]">
                              {voiceOptions.map((voice) => (
                                <SelectItem
                                  key={voice}
                                  value={voice}
                                  className="text-sm capitalize"
                                >
                                  {voice}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8b929b]">
                            System Prompt
                          </Label>
                          <Textarea
                            value={draft.systemPrompt}
                            onChange={(event) =>
                              handleFieldChange(
                                'systemPrompt',
                                event.target.value
                              )
                            }
                            placeholder="Enter system prompt"
                            className="min-h-[130px] border-[#2c323a] bg-[#15181c] text-sm text-[#dfe3e8]"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="background" className="flex-1 min-h-0">
                <TabPlaceholder icon={FileText} title="Background" />
              </TabsContent>
              <TabsContent value="chats" className="flex-1 min-h-0">
                <TabPlaceholder icon={MessageCircle} title="Chats" />
              </TabsContent>
              <TabsContent value="groups" className="flex-1 min-h-0">
                <TabPlaceholder icon={Users} title="Groups" />
              </TabsContent>
              <TabsContent value="memory" className="flex-1 min-h-0">
                <TabPlaceholder icon={Brain} title="Memory" />
              </TabsContent>
            </Tabs>

            <div className="flex items-center justify-between border-t border-[#2a2f36] bg-[#191d22] px-6 py-4">
              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                disabled={!draft.id}
                className="border-[#4b2a2a] text-[#f07b7b] hover:bg-[#2a1414] disabled:border-[#3a3a3a] disabled:text-[#6c6f75]"
              >
                Delete
              </Button>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-[#2f353d] bg-[#161a1f] text-[#dfe3e8] hover:bg-[#22272e]"
                >
                  <MessageCircle className="h-4 w-4 text-[#6cc5ff]" />
                  Chat
                </Button>
                <Button
                  type="button"
                  onClick={handleSave}
                  className="bg-[#0f7cc4] text-white hover:bg-[#1692df]"
                >
                  Save Character
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default CharactersPage
