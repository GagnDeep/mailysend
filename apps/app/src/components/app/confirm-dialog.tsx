import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@mailysend/ui'
import type { ReactNode } from 'react'
import { useId, useState } from 'react'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description: ReactNode
  /**
   * The exact text the reader must type. Present for anything that destroys
   * data or sends mail — a second click is muscle memory, typing a domain name
   * is not.
   */
  confirmPhrase?: string
  confirmLabel: string
  /** Spelled out: what stops working, what is deleted, what cannot be undone. */
  consequences?: ReactNode
  pending?: boolean
  onConfirm: () => void
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel,
  consequences,
  pending = false,
  onConfirm,
}: ConfirmDialogProps) => {
  const [typed, setTyped] = useState('')
  const inputId = useId()
  const ready = !confirmPhrase || typed.trim() === confirmPhrase

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setTyped('')
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {consequences ? (
          <Callout variant="warn" title="this cannot be undone">
            {consequences}
          </Callout>
        ) : null}

        {confirmPhrase ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor={inputId}>
              Type <span className="font-mono text-ink">{confirmPhrase}</span> to confirm
            </Label>
            <Input
              id={inputId}
              value={typed}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-[13.5px]"
              onChange={(event) => setTyped(event.target.value)}
            />
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            disabled={!ready || pending}
            onClick={() => {
              onConfirm()
              setTyped('')
            }}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
