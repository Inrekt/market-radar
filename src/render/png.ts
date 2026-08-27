// Снимок страницы графика в PNG. Всё, что уходит наружу, — путь к файлу: бот
// отдаёт его как фото, скрипты открывают глазами.

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import puppeteer, { TimeoutError, type Browser, type Page } from 'puppeteer'
import { chartHtml, type ChartInput } from './chart.js'

/**
 * Съёмка в двойном разрешении. Телеграм ужимает фото под ширину экрана, и кадр
 * «пиксель в пиксель» после этого выглядит мылом: первыми размазываются линии
 * ликвидности в 1px и курсив подписей.
 */
const DEVICE_SCALE = 2

/**
 * Потолок ожидания флага готовности. Отрисовка двух сотен баров укладывается в
 * доли секунды даже на холодной вкладке; пятнадцать секунд — это уже «страница
 * сломана», а не «страница думает».
 */
const READY_TIMEOUT_MS = 15_000

/** Контейнер из chart.ts: в нём и холст библиотеки, и слой разметки поверх него. */
const CHART_SELECTOR = '#wrap'

/**
 * Больше двух попыток поднять браузер смысла не имеет: одна лечит гонку с уже
 * умершим Chrome, а если и свежезапущенный мёртв — дело не в гонке.
 */
const LAUNCH_ATTEMPTS = 2

/**
 * Один Chrome на процесс: холодный старт браузера — около секунды, и на каждой
 * команде /ta эта секунда видна глазами. Храним промис, а не готовый браузер, —
 * иначе две карточки, запрошенные одновременно, подняли бы по своему Chrome, и
 * один остался бы висеть без владельца.
 */
let launching: Promise<Browser> | null = null

/** Сбрасывает синглтон, только если его с тех пор не заменил другой вызов. */
function forget(stale: Promise<Browser>): void {
  if (launching === stale) launching = null
}

async function browser(): Promise<Browser> {
  for (let attempt = 0; attempt < LAUNCH_ATTEMPTS; attempt++) {
    const pending = (launching ??= puppeteer.launch({ headless: true }))
    let instance: Browser
    try {
      instance = await pending
    } catch (error) {
      // Неудачный запуск не должен залипнуть в синглтоне навсегда: следующая
      // команда обязана попробовать заново, а не получить ту же ошибку из кэша.
      forget(pending)
      throw error
    }
    // Chrome могли убить снаружи (нехватка памяти, сон машины) — тогда живой с
    // виду промис отдаёт труп, и любой вызов по нему упал бы.
    if (instance.connected) return instance
    forget(pending)
  }
  throw new Error('браузер не запускается: Chrome отваливается сразу после старта')
}

/**
 * Пустая картинка хуже ошибки: ошибку видно сразу, а пустой кадр принимают за
 * правду и потом ищут причину в рынке, а не в рендере.
 */
async function waitReady(page: Page, input: ChartInput): Promise<void> {
  try {
    await page.waitForFunction('window.__chartReady === true', { timeout: READY_TIMEOUT_MS })
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error
    throw new Error(
      `график ${input.coin} ${input.interval} не отрисовался за ${READY_TIMEOUT_MS / 1000} с`,
      { cause: error },
    )
  }
}

/**
 * Рисует график и возвращает путь к записанному PNG.
 *
 * Браузер переживает вызов намеренно (см. browser()), поэтому в finally
 * закрывается вкладка, а не он: незакрытые вкладки копят память ровно так же,
 * как копили бы процессы Chrome. Сам браузер закрывает closeBrowser().
 */
export async function renderChart(input: ChartInput, outPath: string): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true })
  const page = await (await browser()).newPage()
  try {
    // Окно ровно под кадр: снимок делается по элементу, но за пределами окна
    // библиотека не считает видимой ни одну цену и разметка не ляжет.
    await page.setViewport({ width: input.width, height: input.height, deviceScaleFactor: DEVICE_SCALE })
    await page.setContent(chartHtml(input), { waitUntil: 'load' })
    await waitReady(page, input)
    const chart = await page.$(CHART_SELECTOR)
    if (chart === null) throw new Error(`на странице графика нет элемента ${CHART_SELECTOR}`)
    // Снимок по элементу, а не по окну: иначе в кадр попадают поля страницы и
    // ширина картинки перестаёт совпадать с шириной графика.
    await chart.screenshot({ path: outPath })
    return outPath
  } finally {
    // Закрытие вкладки не должно перебивать настоящую ошибку рендера: если
    // браузер уже умер, page.close() бросит поверх неё свою, менее полезную.
    await page.close().catch(() => undefined)
  }
}

/**
 * Закрыть браузер. Без этого процесс Node не завершится: связь с Chrome держит
 * событийный цикл живым, и скрипт «зависает» на пустом месте.
 */
export async function closeBrowser(): Promise<void> {
  const pending = launching
  if (pending === null) return
  launching = null
  // Ждём именно запуск: пока браузер поднимается, закрывать нечего, а бросить
  // его на полпути — верный способ оставить осиротевший процесс Chrome.
  await pending.then((instance) => instance.close()).catch(() => undefined)
}
