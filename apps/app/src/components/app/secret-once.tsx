import {
  Button,
  Callout,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useCopy,
} from '@mailysend/ui'
import { Check, Copy } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * The only place a secret is ever rendered.
 *
 * API tokens and webhook signing secrets are stored hashed, so this dialog is
 * not "the convenient place" to see one — it is the only moment the value
 * exists outside the caller's own storage. The copy says exactly that, and the
 * dismiss button says "I've saved it" rather than "Close", because the reader
 * is agreeing to something, not tidying up.
 */
export interface SecretOnceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  secret: string
  /** What this value unlocks and where it belongs. */
  description: ReactNode
  footnote?: ReactNode
}

export const SecretOnceDialog = ({
  open,
  onOpenChange,
  title,
  secret,
  description,
  footnote,
}: SecretOnceDialogProps) => {
  const { copied, failed, copy } = useCopy()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <Callout variant="warn" title="shown once">
          This value is stored hashed. Close this dialog and it is gone — there is no "reveal"
          anywhere in the dashboard, and support cannot recover it either.
        </Callout>

        <div className="flex items-center gap-2 rounded-code border border-line bg-dark p-3.5">
          <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-on-dark">
            {secret}
          </code>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Copy secret"
            className="text-on-dark-3 hover:bg-dark-line hover:text-on-dark"
            onClick={() => copy(secret)}
          >
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>

        {/*
          A copy button that silently did nothing is the worst possible outcome
          for this particular dialog: the reader closes it believing they have
          the key, and the key is gone. So when the clipboard refuses — which is
          what happens over plain HTTP — the dialog says so and tells them what
          to do instead.
        */}
        {failed ? (
          <p className="m-0 text-[13.5px] text-warning">
            This browser would not let us write to the clipboard, which is normal for a page served
            over plain HTTP. Select the value above and copy it by hand before closing.
          </p>
        ) : null}

        {footnote ? <p className="m-0 text-[13.5px] text-muted">{footnote}</p> : null}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>I've saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
