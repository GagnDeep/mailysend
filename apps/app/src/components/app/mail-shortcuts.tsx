import { Kbd, Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@mailysend/ui'

/**
 * The shortcuts, written down.
 *
 * `?` used to be advertised in a paragraph pinned under the folder list that
 * said the key was "not wired yet" and then listed six of the fourteen bindings
 * that did work. An apology in the chrome is worse than no help at all: it
 * takes up the space the help would have occupied and tells the reader the
 * product is unfinished.
 */

const GROUPS: { title: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    title: 'Moving',
    keys: [
      { keys: ['j'], label: 'Next conversation' },
      { keys: ['k'], label: 'Previous conversation' },
      { keys: ['Enter'], label: 'Open the conversation under the cursor' },
      { keys: ['u'], label: 'Back to the list' },
      { keys: ['Esc'], label: 'Close the conversation, or clear the selection' },
      { keys: ['/'], label: 'Search' },
    ],
  },
  {
    title: 'Acting',
    keys: [
      { keys: ['e'], label: 'Archive' },
      { keys: ['#'], label: 'Trash' },
      { keys: ['!'], label: 'Mark as spam' },
      { keys: ['s'], label: 'Star or unstar' },
      { keys: ['Shift', 'U'], label: 'Mark unread' },
      { keys: ['x'], label: 'Select or deselect' },
      { keys: ['*'], label: 'Select every conversation in view' },
    ],
  },
  {
    title: 'Writing',
    keys: [
      { keys: ['c'], label: 'Compose' },
      { keys: ['r'], label: 'Reply' },
      { keys: ['a'], label: 'Reply all' },
      { keys: ['f'], label: 'Forward' },
    ],
  },
]

export function MailShortcuts({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[420px]">
        <SheetHeader>
          <SheetTitle>Keyboard shortcuts</SheetTitle>
          <SheetDescription>
            Gmail's chords, because the muscle memory is not ours to redesign. None of them fire
            while the cursor is in a text field.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="ms-eyebrow m-0 pb-2 text-[10.5px] text-muted-2">{group.title}</h3>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {group.keys.map((entry) => (
                  <li
                    key={entry.label}
                    className="flex items-baseline justify-between gap-3 text-[13px]"
                  >
                    <span className="text-muted">{entry.label}</span>
                    <span className="flex shrink-0 gap-1">
                      {entry.keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
