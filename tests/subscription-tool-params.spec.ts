import { describe, expect, it } from 'vitest'
import { subscriptionToolParameters } from '../src/subscription.js'

describe('subscription image tool parameters', () => {
  it.each(['', '   '])('treats empty placeholders %j as omitted before validating', empty => {
    expect(subscriptionToolParameters('chatgpt-sub', { size: empty, aspectRatio: '1:1', imageSize: empty })).toEqual({ size: '1024x1024' })
    expect(subscriptionToolParameters('grok-sub', { size: '16:9', aspectRatio: empty, imageSize: empty })).toEqual({ size: '16:9' })
    expect(subscriptionToolParameters('google-sub', { size: empty, aspectRatio: empty, imageSize: empty })).toEqual({})
  })

  it('trims valid strings but still rejects unsupported nonempty resolution values with recovery advice', () => {
    expect(subscriptionToolParameters('grok-sub', { aspectRatio: ' 16:9 ', imageSize: ' 2K ' })).toEqual({ size: '16:9', quality: '2k' })
    expect(() => subscriptionToolParameters('chatgpt-sub', { size: '', aspectRatio: '1:1', imageSize: '1K' })).toThrow('image_size')
  })

  it('maps selected ratios and tiers to each subscription wire protocol', () => {
    expect(subscriptionToolParameters('chatgpt-sub', { aspectRatio: '9:16' })).toEqual({ size: '864x1536' })
    expect(subscriptionToolParameters('grok-sub', { aspectRatio: '9:16', imageSize: '2K' })).toEqual({ size: '9:16', quality: '2k' })
    expect(subscriptionToolParameters('google-sub', { aspectRatio: '16:9', imageSize: '4K' })).toEqual({ size: '16:9', quality: 'hd' })
  })

  it('rejects conflicting or unsupported selections instead of silently dropping them', () => {
    expect(() => subscriptionToolParameters('grok-sub', { size: '1024x1024', aspectRatio: '9:16' })).toThrow('只选一个')
    expect(() => subscriptionToolParameters('grok-sub', { imageSize: '4K' })).toThrow('不支持清晰度')
    expect(() => subscriptionToolParameters('google-sub', { imageSize: '2K' })).toThrow('不支持清晰度')
  })
})
