import { describe, expect, it } from 'vitest'
import { aiReferrer, crawlerForUserAgent } from './analytics'

describe('analytics source classification', () => {
  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.3; +https://openai.com/gptbot', 'GPTBot', 'OpenAI', 'AI crawler'],
    ['Claude-SearchBot/1.0', 'Claude-SearchBot', 'Anthropic', 'AI search'],
    ['Mozilla/5.0 (compatible; Perplexity-User/1.0)', 'Perplexity-User', 'Perplexity', 'AI assistant'],
    ['meta-externalagent/1.1', 'meta-externalagent', 'Meta', 'AI crawler'],
    ['Google-CloudVertexBot/1.0', 'Google-CloudVertexBot', 'Google', 'AI crawler'],
  ])('identifies %s', (userAgent, agent, operator, category) => {
    expect(crawlerForUserAgent(userAgent)).toMatchObject({ agent, operator, category })
  })

  it('does not relabel an ordinary browser as an AI crawler', () => {
    expect(crawlerForUserAgent('Mozilla/5.0 Safari/605.1.15')).toBeNull()
  })

  it('recognizes AI referral subdomains without treating lookalikes as referrals', () => {
    expect(aiReferrer('chatgpt.com')).toEqual({ ai: true, operator: 'OpenAI' })
    expect(aiReferrer('links.claude.ai')).toEqual({ ai: true, operator: 'Anthropic' })
    expect(aiReferrer('chatgpt.com.example.org')).toEqual({ ai: false, operator: null })
  })
})
