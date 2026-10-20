import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopy } from '../src/index.ts'

/**
 * The copy buttons, over plain HTTP.
 *
 * `navigator.clipboard` is gated on a secure context, and a MailySend instance
 * is reached over plain HTTP more often than it looks. There, the API is not
 * refused — it is `undefined`, so the old implementation's try/catch returned
 * early and the button neither copied nor said anything. On the dialog that
 * shows an API key once, that is the reader closing it believing they have the
 * key.
 */

const Subject = ({ text = 'ms_live_secret' }: { text?: string }) => {
  const { copied, failed, copy } = useCopy()
  return (
    <button type="button" onClick={() => copy(text)}>
      {failed ? 'failed' : copied ? 'copied' : 'copy'}
    </button>
  )
}

const press = async () => {
  await act(async () => {
    screen.getByRole('button').click()
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** jsdom has no `execCommand`, so the fallback has to be installed to be seen. */
const stubExecCommand = (result: boolean | (() => boolean)) => {
  const exec = vi.fn(() => (typeof result === 'function' ? result() : result))
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
  return exec
}

describe('useCopy', () => {
  it('writes through the clipboard API when there is one', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { clipboard: { writeText } })

    render(<Subject />)
    await press()

    expect(writeText).toHaveBeenCalledWith('ms_live_secret')
    expect(screen.getByRole('button')).toHaveTextContent('copied')
  })

  it('falls back to a selection when the clipboard API is not there at all', async () => {
    vi.stubGlobal('navigator', {})
    const exec = stubExecCommand(true)

    render(<Subject />)
    await press()

    expect(exec).toHaveBeenCalledWith('copy')
    expect(screen.getByRole('button')).toHaveTextContent('copied')
  })

  it('falls back when the clipboard API exists and refuses', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new DOMException('Write permission denied.', 'NotAllowedError')
        }),
      },
    })
    const exec = stubExecCommand(true)

    render(<Subject />)
    await press()

    expect(exec).toHaveBeenCalled()
    expect(screen.getByRole('button')).toHaveTextContent('copied')
  })

  /** The case the UI now has words for, rather than a button that does nothing. */
  it('reports failure when neither path works', async () => {
    vi.stubGlobal('navigator', {})
    stubExecCommand(false)

    render(<Subject />)
    await press()

    expect(screen.getByRole('button')).toHaveTextContent('failed')
  })

  it('leaves no textarea behind, even when the fallback throws', async () => {
    vi.stubGlobal('navigator', {})
    stubExecCommand(() => {
      throw new Error('not supported')
    })

    render(<Subject />)
    await press()

    expect(document.querySelectorAll('textarea')).toHaveLength(0)
    expect(screen.getByRole('button')).toHaveTextContent('failed')
  })
})
