import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Save, AlertTriangle, Check, FileCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { fetchProfile, saveProfile } from '@/lib/api'
import { cn } from '@/lib/utils'

export default function ConfigTab({ name }) {
  const [source, setSource]   = useState('')
  const [dirty,  setDirty]    = useState(false)
  const [saved,  setSaved]    = useState(false)

  const { data: original, isLoading, error: loadError } = useQuery({
    queryKey: ['profile-source', name],
    queryFn : () => fetchProfile(name),
    staleTime: Infinity,
  })

  useEffect(() => {
    if (original != null) {
      setSource(original)
      setDirty(false)
    }
  }, [original])

  const { mutate: save, isPending: isSaving, error: saveError } = useMutation({
    mutationFn: () => saveProfile(name, source),
    onSuccess : () => {
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    },
  })

  function handleChange(e) {
    setSource(e.target.value)
    setDirty(e.target.value !== original)
    setSaved(false)
  }

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <FileCode className="h-4 w-4" />
          <span className="font-mono">profiles/{name}.js</span>
        </div>

        <div className="flex-1" />

        {dirty && (
          <span className="text-xs text-yellow-400 flex items-center gap-1">
            <AlertTriangle className="h-3.5 w-3.5" />
            Unsaved changes
          </span>
        )}
        {saved && (
          <span className="text-xs text-green-400 flex items-center gap-1">
            <Check className="h-3.5 w-3.5" />
            Saved
          </span>
        )}

        <Button
          size="sm"
          className="gap-1.5"
          disabled={!dirty || isSaving || isLoading}
          onClick={() => save()}
        >
          <Save className="h-3.5 w-3.5" />
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      {/* Warning banner */}
      <div className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-400">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        Changes take effect after stopping and restarting the bot.
      </div>

      {loadError ? (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          Could not load profile: {loadError.message}
        </div>
      ) : saveError ? (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
          Save failed: {saveError.message}
        </div>
      ) : null}

      {/* Editor */}
      <Textarea
        className={cn(
          'font-mono text-xs min-h-[calc(100vh-320px)] resize-none bg-black/40 border-border focus-visible:ring-1',
          dirty && 'border-yellow-500/40',
        )}
        value={source}
        onChange={handleChange}
        spellCheck={false}
        disabled={isLoading}
        placeholder={isLoading ? 'Loading…' : ''}
      />
    </div>
  )
}
