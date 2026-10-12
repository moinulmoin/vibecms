import { describe, expect, it } from 'vitest'
import { aiReferrer, crawlerForUserAgent } from './analytics'

describe('analytics source classification', () => {
  it.each([
    ['Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.3; +https://openai.com/gptbot', 'GPTBot', 'OpenAI', 'ai-training'],
    ['Claude-SearchBot/1.0', 'Claude-SearchBot', 'Anthropic', 'ai-search'],
    ['Mozilla/5.0 (compatible; Perplexity-User/1.0)', 'Perplexity-User', 'Perplexity', 'ai-assistant'],
    ['meta-externalagent/1.1', 'meta-externalagent', 'Meta', 'ai-training'],
    ['Google-CloudVertexBot/1.0', 'Google-CloudVertexBot', 'Google', 'ai-training'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1)', 'Googlebot', 'Google', 'search-engine'],
    ['curl/8.5.0', 'curl', 'curl', 'other-bot'],
  ])('identifies %s', (userAgent, id, operator, category) => {
    expect(crawlerForUserAgent(userAgent)).toMatchObject({ id, operator, category })
  })

  it('does not relabel an ordinary browser as an AI crawler', () => {
    expect(crawlerForUserAgent('Mozilla/5.0 Safari/605.1.15')).toBeNull()
    expect(crawlerForUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36')).toBeNull()
  })

  it('recognizes AI referral subdomains without treating lookalikes as referrals', () => {
    expect(aiReferrer('chatgpt.com')).toEqual({ ai: true, operator: 'OpenAI' })
    expect(aiReferrer('links.claude.ai')).toEqual({ ai: true, operator: 'Anthropic' })
    expect(aiReferrer('chatgpt.com.example.org')).toEqual({ ai: false, operator: null })
  })
})
