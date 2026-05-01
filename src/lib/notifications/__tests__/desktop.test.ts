/**
 * Unit tests for the macOS desktop sender (D2).
 *
 * The sender shells out to `osascript` only on darwin. On non-darwin
 * platforms it logs a one-shot console.warn and returns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendDesktopNotification, __resetDesktopWarnedForTests } from '../desktop'

describe('notifications desktop sender', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let execMock: any

  beforeEach(() => {
    execMock = vi.fn().mockResolvedValue(undefined)
    __resetDesktopWarnedForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shells out to osascript on darwin', async () => {
    await sendDesktopNotification({
      title: 'YALC',
      body: 'Approve the proposed sequence?',
      platform: 'darwin',
      exec: execMock,
    })
    expect(execMock).toHaveBeenCalledOnce()
    const [bin, args] = execMock.mock.calls[0]
    expect(bin).toBe('osascript')
    // The script should reference both title and body strings.
    const joined = (args as string[]).join(' ')
    expect(joined).toContain('YALC')
    expect(joined).toContain('Approve the proposed sequence?')
  })

  it('escapes embedded double-quotes safely', async () => {
    await sendDesktopNotification({
      title: 'YALC',
      body: 'He said "hi"',
      platform: 'darwin',
      exec: execMock,
    })
    expect(execMock).toHaveBeenCalledOnce()
    // We only require that no unescaped double quote ends up inside the
    // AppleScript string literal — inspecting the joined arg should not
    // contain `"hi"` as an unescaped pair.
    const args = execMock.mock.calls[0][1] as string[]
    const script = args.find((a) => a.includes('display notification')) ?? ''
    // Escaped form: \" — present.
    expect(script).toMatch(/\\"hi\\"/)
  })

  it('is a no-op on non-darwin and warns once', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await sendDesktopNotification({
      title: 'YALC',
      body: 'x',
      platform: 'linux',
      exec: execMock,
    })
    await sendDesktopNotification({
      title: 'YALC',
      body: 'y',
      platform: 'linux',
      exec: execMock,
    })
    expect(execMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    warnSpy.mockRestore()
  })
})
