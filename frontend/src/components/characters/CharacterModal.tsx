import type { ChangeEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Brain,
  FileText,
  MessageCircle,
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
import type { CharacterDraft } from '@/components/characters/types'

const voiceOptions = ['lydia', 'nova', 'atlas', 'rhea', 'sage', 'ember']

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

type CharacterModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  draft: CharacterDraft
  onFieldChange: (key: keyof CharacterDraft, value: string) => void
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void
  onSave: () => void
  onDelete: () => void
}

function CharacterModal({
  open,
  onOpenChange,
  draft,
  onFieldChange,
  onImageChange,
  onSave,
  onDelete,
}: CharacterModalProps) {
  const headerName = draft.name.trim() || 'Character name'
  const fileInputId = `character-image-${draft.id ?? 'new'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

            <TabsContent value="profile" className="flex-1 min-h-0 overflow-hidden">
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
                    onChange={onImageChange}
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
                            onFieldChange('globalPrompt', event.target.value)
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
                            onFieldChange('name', event.target.value)
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
                          onValueChange={(value) => onFieldChange('voice', value)}
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
                            onFieldChange('systemPrompt', event.target.value)
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
              onClick={onDelete}
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
                onClick={onSave}
                className="bg-[#0f7cc4] text-white hover:bg-[#1692df]"
              >
                Save Character
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CharacterModal
