import { type ChangeEvent } from 'react'

import { type Character } from '@/components/characters/types'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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

type VoiceOption = {
  value: string
  label: string
}

type CharacterEditorProps = {
  character: Character
  voiceOptions?: VoiceOption[]
  onChange: (updates: Partial<Character>) => void
  onDelete?: () => void
  onSave?: () => void
}

function CharacterEditor({
  character,
  voiceOptions = [],
  onChange,
  onDelete,
  onSave,
}: CharacterEditorProps) {
  const displayName = character.name.trim() || 'Character Name'
  const isPlaceholderName = !character.name.trim()
  const inputClassName = cn(
    'h-10 border-[#2d3138] bg-[#171a1f] text-sm text-[#dfe3e8] shadow-none',
    'placeholder:text-[#6c7480] focus-visible:border-[#3a414b] focus-visible:ring-[#2c323a]'
  )
  const textareaClassName = cn(
    'border-[#2d3138] bg-[#171a1f] text-sm text-[#dfe3e8] shadow-none',
    'placeholder:text-[#6c7480] focus-visible:border-[#3a414b] focus-visible:ring-[#2c323a]',
    '[field-sizing:fixed] resize-y overflow-y-auto'
  )
  const labelClassName = 'text-sm font-medium text-[#cbd2da]'

  const handleMainImageChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]

    if (!file) {
      onChange({ imageDataUrl: undefined })
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onChange({ imageDataUrl: reader.result })
      }
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex h-full w-full flex-col rounded-2xl border border-[#2b3139] bg-[#171a1f]/75 p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9 border border-[#2b3139] bg-[#121418]">
            {character.imageDataUrl ? (
              <AvatarImage src={character.imageDataUrl} alt="" />
            ) : null}
            <AvatarFallback className="bg-[#121418]" />
          </Avatar>
          <div
            className={cn(
              'text-sm font-semibold',
              isPlaceholderName ? 'text-[#8b929b]' : 'text-[#e5ebf3]'
            )}
          >
            {displayName}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="destructive"
            className="bg-[#7c3a3a] text-[#f5dcdc] hover:bg-[#8f4343]"
            type="button"
            onClick={onDelete}
            disabled={!onDelete}
          >
            Delete
          </Button>
          <Button
            size="sm"
            className="bg-[#cfe7ff] text-[#10263a] hover:bg-[#deefff]"
            type="button"
            onClick={onSave}
            disabled={!onSave}
          >
            Save
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profile" className="mt-6 flex h-full flex-col">
        <TabsList className="h-auto w-full justify-start gap-6 rounded-none border-b border-[#2a2f36] bg-transparent p-0">
          {['Profile', 'Persona', 'Chats', 'Groups', 'Memory'].map((label) => {
            const value = label.toLowerCase()
            return (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  'relative flex-none rounded-none border-0 bg-transparent px-0 pb-3 pt-0 text-sm font-medium text-[#8c939d] shadow-none',
                  'h-auto',
                  "after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:rounded-full after:bg-transparent after:content-['']",
                  'data-[state=active]:text-[#e5ebf3] data-[state=active]:shadow-none data-[state=active]:after:bg-[#4aa3ff]'
                )}
              >
                {label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        <TabsContent value="profile" className="mt-6 flex-1">
          <div className="grid w-full items-start gap-8 md:grid-cols-[300px_minmax(0,1fr)]">
            <div className="flex w-full flex-col gap-4">
              <label
                htmlFor="character-main-image"
                className={cn(
                  'group relative flex aspect-[3/4] w-full max-w-[300px] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-[#2b3139] bg-[#14171b]',
                  'transition-colors hover:border-[#3a414b]'
                )}
              >
                {character.imageDataUrl ? (
                  <img
                    src={character.imageDataUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="sr-only">Upload image</span>
                )}
              </label>
              <input
                id="character-main-image"
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={handleMainImageChange}
              />
            </div>

            <div className="flex flex-col gap-4 md:min-h-[400px] md:justify-between">
              <div className="flex flex-col gap-4">
                <div className="w-full max-w-[520px] space-y-2 md:w-3/4">
                  <Label
                    htmlFor="global-system-prompt"
                    className={labelClassName}
                  >
                    Global Roleplay System Prompt
                  </Label>
                  <Textarea
                    id="global-system-prompt"
                    rows={2}
                    value={character.globalPrompt}
                    onChange={(event) =>
                      onChange({ globalPrompt: event.target.value })
                    }
                    className={cn(
                      textareaClassName,
                      'h-[52px] min-h-[52px]'
                    )}
                  />
                </div>

                <div className="w-full max-w-[360px] space-y-2">
                  <Label htmlFor="character-name" className={labelClassName}>
                    Character Name
                  </Label>
                  <Input
                    id="character-name"
                    value={character.name}
                    onChange={(event) => onChange({ name: event.target.value })}
                    className={inputClassName}
                  />
                </div>

                <div className="w-full max-w-[360px] space-y-2">
                  <Label className={labelClassName}>Voice</Label>
                  <Select
                    value={character.voice}
                    onValueChange={(value) => onChange({ voice: value })}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select voice" />
                    </SelectTrigger>
                    <SelectContent>
                      {voiceOptions.map((voice) => (
                        <SelectItem key={voice.value} value={voice.value}>
                          {voice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="w-full max-w-[520px] space-y-2 md:w-3/4">
                <Label className={labelClassName}>System Prompt</Label>
                <Textarea
                  rows={4}
                  value={character.systemPrompt}
                  onChange={(event) =>
                    onChange({ systemPrompt: event.target.value })
                  }
                  className={cn(
                    textareaClassName,
                    'h-[96px] min-h-[96px]'
                  )}
                />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="persona" className="flex-1" />
        <TabsContent value="chats" className="flex-1" />
        <TabsContent value="groups" className="flex-1" />
        <TabsContent value="memory" className="flex-1" />
      </Tabs>
    </div>
  )
}

export default CharacterEditor
