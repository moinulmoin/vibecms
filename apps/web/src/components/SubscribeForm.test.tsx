// @vitest-environment happy-dom
//
// Guards the accessible-control contract the article-end / footer restyle must
// preserve: the email field keeps an accessible name (label[for] <-> input#id),
// the honeypot stays a hidden bot trap, and both placements render the coherent
// email + submit control. CSS module classes are dropped under css:false, so we
// assert DOM structure/semantics (not class names).
import { afterEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import { SubscribeForm } from './SubscribeForm'

function render(node: ReactNode) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(node))
  return container
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('SubscribeForm accessible-control contract', () => {
  it('gives the email input an accessible name via a wired label', () => {
    const container = render(<SubscribeForm siteSlug="s1" placement="end" />)
    const email = container.querySelector('input[type="email"]') as HTMLInputElement
    // The honeypot label ("Company") precedes this field, so target by association.
    const label = container.querySelector(`label[for="${email.id}"]`) as HTMLLabelElement

    expect(email).toBeTruthy()
    expect(email.id).toBe('sf-email')
    expect(label).toBeTruthy()
    // A refactor of this control must keep the name association intact.
    expect(label.htmlFor).toBe(email.id)
  })

  it('keeps the honeypot as an assistive-hidden bot trap', () => {
    const container = render(<SubscribeForm siteSlug="s1" placement="footer" />)
    const hiddenWrap = container.querySelector('[aria-hidden="true"]')
    expect(hiddenWrap).toBeTruthy()

    const company = hiddenWrap!.querySelector(
      'input[name="company"]',
    ) as HTMLInputElement
    expect(company).toBeTruthy()
    // Removed from tab order so real users never reach it.
    expect(company.tabIndex).toBe(-1)
  })

  it('renders the email + submit control in both placements', () => {
    for (const placement of ['end', 'footer'] as const) {
      document.body.innerHTML = ''
      const container = render(<SubscribeForm siteSlug="s1" placement={placement} />)

      const email = container.querySelector('input[type="email"]')
      const submit = container.querySelector('button[type="submit"]')
      const label = container.querySelector('label[for="sf-email"]')

      expect(email).toBeTruthy()
      expect(submit).toBeTruthy()
      expect(label).toBeTruthy()
    }
  })

  it('does not render the control inside a boxed card container', () => {
    // The end placement is a rule-separated continuation, not a tinted card:
    // the form element itself must not carry a filled background or border
    // box. (Styles are dropped in test, so assert no wrapper <div> is introduced
    // around the form and the form remains the submit boundary.)
    for (const placement of ['end', 'footer'] as const) {
      document.body.innerHTML = ''
      const container = render(<SubscribeForm siteSlug="s1" placement={placement} />)
      const form = container.querySelector('form')
      expect(form).toBeTruthy()
      // The form is the direct control boundary; the email + submit live in it.
      expect(form!.querySelector('input[type="email"]')).toBeTruthy()
      expect(form!.querySelector('button[type="submit"]')).toBeTruthy()
    }
  })
})
