import { describe, expect, it, vi } from 'vitest'

vi.mock('@react-email/render', () => ({
  render: (node: { props?: { code?: string } }) => `<p>Your code is ${node.props?.code}</p>`,
}))

const element = (code: string) => ({
  $$typeof: Symbol.for('react.element'),
  type: 'LoginCode',
  props: { code },
})

describe('renderReact', () => {
  it('renders a React element through the peer dependency', async () => {
    const { renderReact } = await import('../src/render.ts')
    await expect(renderReact(element('814205'))).resolves.toBe('<p>Your code is 814205</p>')
  })

  it('turns an element into html and drops react from the payload', async () => {
    const { withRenderedReact } = await import('../src/render.ts')
    const body = await withRenderedReact({
      from: 'a@example.com',
      react: element('814205'),
    } as { from: string; react: unknown })

    expect(body).toEqual({ from: 'a@example.com', html: '<p>Your code is 814205</p>' })
    expect('react' in body).toBe(false)
  })

  it('passes a pre-rendered string through as html', async () => {
    const { withRenderedReact } = await import('../src/render.ts')
    const body = await withRenderedReact({ react: '<p>already html</p>' })
    expect(body).toEqual({ html: '<p>already html</p>' })
  })

  it('leaves a payload without react alone', async () => {
    const { withRenderedReact } = await import('../src/render.ts')
    expect(await withRenderedReact({ html: '<p>hi</p>' })).toEqual({ html: '<p>hi</p>' })
  })
})
