// Снимок страницы графика в PNG. Всё, что уходит наружу, — путь к файлу: бот
// отдаёт его как фото, скрипты открывают глазами.

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import puppeteer, { TimeoutError, type Browser, type ElementHandle, type Page } from 'puppeteer'
import { chartHtml, type ChartInput } from './chart.js'

/**
 * Флаги запуска браузера. Без них снимки не делаются на сервере, а на машине
 * владельца всё работает — поэтому дефект и дожил до облака.
 *
 * --no-sandbox: в контейнере GitHub Actions ядро запрещает песочницу без
 *   привилегий (Ubuntu 23.10+ закрывает user namespaces через AppArmor), и
 *   Chrome падает с «No usable sandbox». Замерено 28.08.2026: одиннадцать
 *   готовых пингов умерли ровно здесь.
 * --disable-dev-shm-usage: /dev/shm в контейнере крошечный, а карточки у нас
 *   2880×3600 — браузер упирается в него на больших снимках.
 * --disable-gpu: на сервере видеокарты нет, попытка её искать только тормозит
 *   запуск.
 */
const LAUNCH_ARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']

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
 * Окно, в котором страница открывается до первого замера. Свой размер знает
 * только сама страница — она задаёт кадр в пикселях, — а спросить её об этом
 * можно лишь после загрузки, когда скрипт уже отработал. Рисовать в окне меньше
 * кадра нельзя: часть страницы оказывается за границей окна, и библиотека
 * графиков не считает эти цены видимыми. Поэтому стартовое окно заведомо больше
 * любой карточки; лишнее в снимок не попадёт — он делается по элементу.
 */
const START_VIEWPORT_W = 1600
const START_VIEWPORT_H = 1200

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
    const pending = (launching ??= puppeteer.launch({
      headless: true,
      args: LAUNCH_ARGS,
    }))
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
async function waitReady(page: Page, label: string): Promise<void> {
  try {
    await page.waitForFunction('window.__chartReady === true', { timeout: READY_TIMEOUT_MS })
  } catch (error) {
    if (!(error instanceof TimeoutError)) throw error
    throw new Error(
      `карточка «${label}» не отрисовалась за ${READY_TIMEOUT_MS / 1000} с`,
      { cause: error },
    )
  }
}

/**
 * Подгоняет окно под кадр. Замер идёт сразу после загрузки, когда размеры уже
 * известны, но отрисовка ещё впереди (страница выставляет флаг готовности из
 * requestAnimationFrame), — так кадр гарантированно целиком внутри окна к моменту
 * снимка. Масштаб (deviceScaleFactor) здесь не трогаем: холсты уже созданы под
 * него, и смена на ходу дала бы мыло вместо чёткой картинки.
 */
async function fitViewport(page: Page, frame: ElementHandle<Element>): Promise<void> {
  const box = await frame.boundingBox()
  // null означает, что элемент не отрисован (display:none или нулевой размер) —
  // менять окно не по чему, а ошибку тут поднимать рано: снимок скажет яснее.
  if (box === null) return
  await page.setViewport({
    width: Math.max(1, Math.ceil(box.width)),
    height: Math.max(1, Math.ceil(box.height)),
    deviceScaleFactor: DEVICE_SCALE,
  })
}

/**
 * Снимает готовую страницу в PNG и возвращает путь к нему. Страница обязана быть
 * самодостаточной (без выхода в сеть), задавать размер кадра в пикселях сама и
 * выставлять window.__chartReady, когда рисовать больше нечего.
 *
 * label — человекочитаемое имя карточки: оно попадёт в текст ошибки, если кадр
 * не успел отрисоваться. «SOL 15m» в ошибке говорит больше, чем селектор.
 *
 * Браузер переживает вызов намеренно (см. browser()), поэтому в finally
 * закрывается вкладка, а не он: незакрытые вкладки копят память ровно так же,
 * как копили бы процессы Chrome. Сам браузер закрывает closeBrowser().
 */
export async function renderHtml(
  html: string,
  outPath: string,
  selector: string,
  label: string,
): Promise<string> {
  await mkdir(dirname(outPath), { recursive: true })
  const page = await (await browser()).newPage()
  try {
    await page.setViewport({
      width: START_VIEWPORT_W,
      height: START_VIEWPORT_H,
      deviceScaleFactor: DEVICE_SCALE,
    })
    await page.setContent(html, { waitUntil: 'load' })
    const frame = await page.$(selector)
    if (frame === null) throw new Error(`на странице «${label}» нет элемента ${selector}`)
    await fitViewport(page, frame)
    await waitReady(page, label)
    // Снимок по элементу, а не по окну: иначе в кадр попадают поля страницы и
    // ширина картинки перестаёт совпадать с шириной карточки.
    await frame.screenshot({ path: outPath })
    return outPath
  } finally {
    // Закрытие вкладки не должно перебивать настоящую ошибку рендера: если
    // браузер уже умер, page.close() бросит поверх неё свою, менее полезную.
    await page.close().catch(() => undefined)
  }
}

/** Карточка структуры: свечи, зоны, линии. */
export async function renderChart(input: ChartInput, outPath: string): Promise<string> {
  return renderHtml(chartHtml(input), outPath, CHART_SELECTOR, `${input.coin} ${input.interval}`)
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
