import { describe, expect, it } from 'vitest'
import { altFromFileName } from './image-alt'

describe('altFromFileName', () => {
  it('drops meaningless camera and clipboard names', () => {
    for (const name of ['IMG_1234.png', 'image.png', 'Screenshot 2024-05-01 at 10.22.31 AM.png', 'DSC00012.JPG', 'PXL_20240101_101010.jpg', '20240102_101500.jpg', 'a8f3c9e1b2d4.webp', 'pasted-image.png']) {
      expect(altFromFileName(name), name).toBe('')
    }
  })

  it('turns descriptive names into sentence text', () => {
    expect(altFromFileName('team-offsite_lisbon.jpg')).toBe('Team offsite lisbon')
    expect(altFromFileName('dashboardOverview.png')).toBe('Dashboard Overview')
  })
})
