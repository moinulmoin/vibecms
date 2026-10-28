import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SubscribeBlock } from '@vc/content/public-chrome'
import { newsletterSettingsSchema } from '@vc/validators'
import { applyPublicSecurityHeaders } from './server/secure-response-headers'

// Approved newsletter scenario: the same validated configuration controls the
// public form and the only additional CSP form destination.
describe('external newsletter connection', () => {
  it('renders the provider form and permits only its origin, rejecting unsafe settings', async () => {
    const externalForm = { action: 'https://buttondown.com/api/emails/embed-subscribe/example', emailField: 'fields[email]' }
    const settings = newsletterSettingsSchema.parse({ enabled: true, heading: 'Updates', subtext: 'Subscribe for updates.', buttonLabel: 'Subscribe', externalForm })
    const markup = renderToStaticMarkup(createElement(SubscribeBlock, { siteSlug: 'example', variant: 'footer', settings }))
    expect(markup).toContain('method="post"')
    expect(markup).toContain(`action="${externalForm.action}"`)
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('name="fields[email]"')
    expect(markup).toContain('type="email"')
    expect(markup).toContain('required=""')
    expect(markup).not.toContain('name="company"')
    expect(markup).not.toContain('data-site-slug')
    const headers = new Headers({ 'content-type': 'text/html' })
    applyPublicSecurityHeaders('/', 'text/html', headers, undefined, new URL(externalForm.action).origin)
    expect(headers.get('content-security-policy')?.split('; ').find((value) => value.startsWith('form-action '))).toBe("form-action 'self' https://buttondown.com")
    for (const action of ['http://buttondown.com/form', 'https://user@buttondown.com/form', 'https://localhost/form', `https://buttondown.com/${'a'.repeat(500)}`]) {
      expect(newsletterSettingsSchema.safeParse({ ...settings, externalForm: { ...externalForm, action } }).success).toBe(false)
    }
    expect(newsletterSettingsSchema.safeParse({ ...settings, externalForm: { ...externalForm, emailField: 'bad field' } }).success).toBe(false)
    let listener: ((event: { target: unknown; preventDefault: () => void }) => void) | undefined
    class Element { hidden = true; textContent = '' }
    class Form {
      classList = { contains: (name: string) => name === 'vc-subscribe-form' }
      dataset = { externalForm: 'true' }
      success = new Element()
      querySelector(selector: string) { return selector === '[data-subscribe-success]' ? this.success : null }
    }
    const form = new Form()
    let prevented = false
    const fetchSpy = vi.fn()
    vi.stubGlobal('document', { addEventListener: (_name: string, callback: typeof listener) => { listener = callback } })
    vi.stubGlobal('HTMLFormElement', Form)
    vi.stubGlobal('HTMLElement', Element)
    vi.stubGlobal('fetch', fetchSpy)
    try {
      // The script registers against document on load, so install the DOM harness first.
      // @ts-expect-error Browser script is imported for its submit handler side effect.
      await import('./scripts/subscribe-form.js')
      listener?.({ target: form, preventDefault: () => { prevented = true } })
      expect(prevented).toBe(false)
      expect(fetchSpy).not.toHaveBeenCalled()
      expect(form.success.hidden).toBe(false)
      expect(form.success.textContent).toBe('Finish signing up in the new tab.')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
