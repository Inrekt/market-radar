import { describe, expect, it, beforeAll, afterAll, vi } from 'vitest'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { readEvents, alertsOf, candidatesOf, type ScanEvent } from './events.js'

describe('readEvents', () => {
  // Время последней записи в реальном архиве (2026-08-27 18:40:10 UTC)
  const archiveEnd = 1787862010 * 1000

  it('загружает события за окно, собирая из суточного файла', async () => {
    // Запросим 48 часов, это должно захватить события из архива
    const events = await readEvents(48, archiveEnd)

    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.coin).toBeDefined()
    expect(events[0]!.px).toBeGreaterThan(0)
  })

  it('сортирует события по времени', async () => {
    const events = await readEvents(48, archiveEnd)

    for (let i = 1; i < events.length; i++) {
      expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t)
    }
  })

  it('пропускает битые JSON-строки, не роняя весь файл', async () => {
    // Создаём временный каталог с тестовыми файлами
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    // Используем дату 2026-08-27 чтобы соответствовать временам событий
    const testFile = path.join(eventsDir, '2026-08-27.ndjson')
    // Хорошая строка, битая строка, еще хорошая строка
    const content =
      '{"t":1787856779,"kind":"candidate","coin":"SOL","px":150.5,"score":0.1,"top":["strength"]}\n' +
      'this is not json at all\n' +
      '{"t":1787856800,"kind":"alert","coin":"BTC","px":42000,"score":0.5,"top":["funding"]}\n'

    await writeFile(testFile, content, 'utf-8')

    // Используем временный каталог через STATE_DIR env
    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      // Запросим события вокруг времени первой записи (48 часов окна)
      const events = await readEvents(48, 1787856779 * 1000 + 2 * 3600 * 1000)

      // Должны загрузиться обе хорошие строки, битая пропущена
      const testEvents = events.filter((e) => e.coin === 'SOL' || e.coin === 'BTC')
      expect(testEvents.length).toBe(2)
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })

  it('отбрасывает записи без обязательных полей (t, coin, px)', async () => {
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test-required'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    // Дата 2026-08-29 соответствует timestamp 1788000000
    const testFile = path.join(eventsDir, '2026-08-29.ndjson')
    // Хорошая запись
    const good = '{"t":1788000000,"kind":"candidate","coin":"ETH","px":2500,"score":0.2,"top":[]}\n'
    // Нет px
    const noPx = '{"t":1788000001,"kind":"candidate","coin":"ADA","score":0.3,"top":[]}\n'
    // Нет coin
    const noCoin = '{"t":1788000002,"kind":"candidate","px":100,"score":0.4,"top":[]}\n'
    // Нет t
    const noT = '{"kind":"candidate","coin":"XRP","px":2,"score":0.5,"top":[]}\n'

    await writeFile(testFile, good + noPx + noCoin + noT, 'utf-8')

    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      const events = await readEvents(24, 1788000000 * 1000 + 3600 * 1000)

      // Только одна хорошая запись должна загрузиться
      expect(events.length).toBe(1)
      expect(events[0]!.coin).toBe('ETH')
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })

  it('отбрасывает записи с неизвестным kind', async () => {
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test-kind'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    // Дата 2026-08-30 соответствует timestamp 1788100000
    const testFile = path.join(eventsDir, '2026-08-30.ndjson')
    // Хорошие записи
    const candidate = '{"t":1788100000,"kind":"candidate","coin":"SOL","px":150,"score":0.1,"top":[]}\n'
    const alert = '{"t":1788100001,"kind":"alert","coin":"BTC","px":40000,"score":0.2,"top":[]}\n'
    // Неизвестный kind
    const unknown = '{"t":1788100002,"kind":"whale_signal","coin":"ETH","px":2000,"score":0.3,"top":[]}\n'

    await writeFile(testFile, candidate + alert + unknown, 'utf-8')

    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      const events = await readEvents(24, 1788100000 * 1000 + 3600 * 1000)

      // Только два известных kind должны загрузиться
      expect(events.length).toBe(2)
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })

  it('не падает, если файл отсутствует', async () => {
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test-missing'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      // Просим события, но файлов вообще нет
      const events = await readEvents(24, 1788200000 * 1000)

      // Должны вернуться пустые события, без ошибки
      expect(events).toEqual([])
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })

  it('загружает события, пересекая полночь UTC', async () => {
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test-midnight'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    // Полночь 2026-08-28 UTC = 1787875200
    // Событие за день 27-го (перед полночью)
    const file27 = path.join(eventsDir, '2026-08-27.ndjson')
    const content27 = '{"t":1787871600,"kind":"candidate","coin":"SOL","px":150,"score":0.1,"top":["strength"]}\n' // 2026-08-27 23:00:00 UTC

    // Событие за день 28-го (после полночи)
    const file28 = path.join(eventsDir, '2026-08-28.ndjson')
    const content28 = '{"t":1787878800,"kind":"alert","coin":"BTC","px":40000,"score":0.2,"top":["funding"]}\n' // 2026-08-28 01:00:00 UTC

    await writeFile(file27, content27, 'utf-8')
    await writeFile(file28, content28, 'utf-8')

    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      // Запросим 25 часов (больше суток) чтобы охватить обе даты UTC
      const endTime = 1787878800 * 1000 + 3600 * 1000 // 2026-08-28 02:00:00 UTC
      const events = await readEvents(25, endTime)

      // Должны загрузиться события с обоих дней
      expect(events.length).toBe(2)
      expect(events[0]!.coin).toBe('SOL') // первое событие
      expect(events[1]!.coin).toBe('BTC') // второе событие
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })

  it('заполняет score и top дефолтными значениями если они отсутствуют', async () => {
    const stateBaseDir = '/private/tmp/claude-501/-Users-user-Desktop-zenta-final/45834213-5d38-4618-b164-561813dd09dc/scratchpad/events-test-defaults'
    const eventsDir = path.join(stateBaseDir, 'events')
    await mkdir(eventsDir, { recursive: true })

    // Дата 2026-09-01 соответствует timestamp 1788300000
    const testFile = path.join(eventsDir, '2026-09-01.ndjson')
    // Нет score и top
    const content = '{"t":1788300000,"kind":"candidate","coin":"XRP","px":2.5}\n'

    await writeFile(testFile, content, 'utf-8')

    const oldStateDir = process.env.STATE_DIR
    try {
      process.env.STATE_DIR = stateBaseDir
      const events = await readEvents(24, 1788300000 * 1000 + 3600 * 1000)

      expect(events.length).toBe(1)
      expect(events[0]!.score).toBe(0)
      expect(events[0]!.top).toEqual([])
    } finally {
      if (oldStateDir) process.env.STATE_DIR = oldStateDir
      else delete process.env.STATE_DIR
    }
  })
})

describe('alertsOf', () => {
  it('фильтрует только alert события', async () => {
    const events: ScanEvent[] = [
      { t: 100, kind: 'candidate', coin: 'SOL', px: 150, score: 0.1, top: [] },
      { t: 101, kind: 'alert', coin: 'BTC', px: 40000, score: 0.5, top: ['funding'] },
      { t: 102, kind: 'candidate', coin: 'ETH', px: 2500, score: 0.2, top: [] },
      { t: 103, kind: 'alert', coin: 'ADA', px: 0.5, score: 0.3, top: [] },
    ]

    const alerts = alertsOf(events)

    expect(alerts.length).toBe(2)
    expect(alerts[0]!.coin).toBe('BTC')
    expect(alerts[1]!.coin).toBe('ADA')
  })

  it('возвращает пустой массив если нет alert событий', () => {
    const events: ScanEvent[] = [
      { t: 100, kind: 'candidate', coin: 'SOL', px: 150, score: 0.1, top: [] },
      { t: 101, kind: 'candidate', coin: 'BTC', px: 40000, score: 0.5, top: [] },
    ]

    const alerts = alertsOf(events)

    expect(alerts).toEqual([])
  })
})

describe('candidatesOf', () => {
  it('фильтрует только candidate события', async () => {
    const events: ScanEvent[] = [
      { t: 100, kind: 'candidate', coin: 'SOL', px: 150, score: 0.1, top: [] },
      { t: 101, kind: 'alert', coin: 'BTC', px: 40000, score: 0.5, top: ['funding'] },
      { t: 102, kind: 'candidate', coin: 'ETH', px: 2500, score: 0.2, top: [] },
      { t: 103, kind: 'alert', coin: 'ADA', px: 0.5, score: 0.3, top: [] },
    ]

    const candidates = candidatesOf(events)

    expect(candidates.length).toBe(2)
    expect(candidates[0]!.coin).toBe('SOL')
    expect(candidates[1]!.coin).toBe('ETH')
  })

  it('возвращает пустой массив если нет candidate событий', () => {
    const events: ScanEvent[] = [
      { t: 100, kind: 'alert', coin: 'SOL', px: 150, score: 0.1, top: [] },
      { t: 101, kind: 'alert', coin: 'BTC', px: 40000, score: 0.5, top: [] },
    ]

    const candidates = candidatesOf(events)

    expect(candidates).toEqual([])
  })
})
