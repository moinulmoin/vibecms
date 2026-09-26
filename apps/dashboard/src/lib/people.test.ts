import { describe, expect, it } from 'vitest'
import { personLabel } from './people'

describe('personLabel', () => {
  const me = { email: 'owner+blog@example.com', name: '' }
  it('names the signed-in user "You"', () => {
    expect(personLabel('Owner+Blog@example.com', me)).toBe('You')
  })
  it('never shows another person\'s full email', () => {
    expect(personLabel('sam+test@example.com', me)).toBe('sam')
  })
  it('never guesses "You" from a shared display name', () => {
    expect(personLabel('Sam', { email: 'owner@example.com', name: 'Sam' })).toBe('Sam')
  })
  it('keeps agent and display names as they are', () => {
    expect(personLabel('My agent', me)).toBe('My agent')
    expect(personLabel('', me)).toBe('Someone')
  })
})
