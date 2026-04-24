import './style.css'
import { prepareWithSegments, layoutNextLine, walkLineRanges, materializeLineRange } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.55)'
const FPS = 30
const CHAR_FONT_SIZE = 14
const BG_FONT_SIZE = 12
const BG_LINE_HEIGHT = 16

// Parallax: top rows scroll slowly (far), bottom rows scroll fast (near)
const PARALLAX_MIN = 0.08
const PARALLAX_MAX = 2.4
const BASE_LINES_PER_SEC = 5

const DEFAULT_BG_TEXT =
  '연합뉴스 속보. 최신 뉴스를 불러오는 중입니다. ' +
  'The web renders text through a pipeline designed thirty years ago for static documents. ' +
  'A browser loads a font, shapes the text into glyphs, measures their combined width, ' +
  'determines where lines break, and positions each line vertically. ' +
  'Every step depends on the previous one. Every step requires the rendering engine to ' +
  'consult its internal layout tree — a structure so expensive that browsers guard access ' +
  'behind synchronous reflow barriers that can freeze the main thread for tens of milliseconds. ' +
  'Pretext removes that constraint. Text information becomes abundant and cheap. ' +
  'You can ask how text would look at a thousand different widths in the time it used to ' +
  'take to ask about one. Real-time text reflow around animated obstacles — every frame, ' +
  'at sixty frames per second. '

// ── Canvas Setup ──
const app = document.getElementById('app')
const canvas = document.createElement('canvas')
app.appendChild(canvas)
const ctx = canvas.getContext('2d')

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let isWalking = false
let direction = 1

let lineHeight = CHAR_FONT_SIZE
let measuredFrames = []
let globalMaxWidth = 0
let globalMaxHeight = 0
let scale = 1
let charScreenX = 0
let charScreenY = 0
let vw = 0
let vh = 0

// Background text state
let bgText = ''
let bgPrepared = null
let allLineRanges = []   // { start, end, width }[]
let allLineTexts = []    // string[] pre-materialized for fast drawing
let timeOffset = 0       // seconds elapsed

// ── Font helpers ──
function getCharFont() { return `${CHAR_FONT_SIZE}px "Geist Mono", monospace` }
function getBgFont()   { return `${BG_FONT_SIZE}px "Geist Mono", monospace` }

// ── Font Loading ──
async function loadFont() {
  try {
    const font = new FontFace(
      'Geist Mono',
      "url('https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff2')"
    )
    const loaded = await font.load()
    document.fonts.add(loaded)
  } catch (e) {
    console.warn('Geist Mono load failed, using monospace fallback:', e)
  }
}

// ── News Fetch ──
// Parses RSS XML into an array of {title, description} items
function parseRss(xmlText) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlText, 'application/xml')
  const items = [...doc.querySelectorAll('item')]
  return items.map(item => ({
    title: item.querySelector('title')?.textContent?.trim() ?? '',
    description: item.querySelector('description')?.textContent
      ?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() ?? '',
  }))
}

async function fetchNews() {
  // Use allorigins.win CORS proxy to fetch RSS feeds directly
  const rssUrls = [
    'https://www.yna.co.kr/rss/news.xml',
    'https://world.kbs.co.kr/rss/rss_korean.htm',
    'https://feeds.bbci.co.uk/korean/rss.xml',
  ]
  for (const rssUrl of rssUrls) {
    try {
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(rssUrl)}`
      const res  = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) })
      const xml  = await res.text()
      const items = parseRss(xml)
      if (items.length > 0) {
        bgText = items.map(({ title, description }) =>
          [title, description].filter(Boolean).join('. ')
        ).join(' ◆ ')
        break
      }
    } catch (_) {}
  }
  if (!bgText) bgText = DEFAULT_BG_TEXT
  preLayoutBgText()
}

// ── Pre-layout background text with pretext editorial engine ──
function preLayoutBgText() {
  if (!bgText || vw <= 0) return
  ctx.font = getBgFont()
  // Repeat text to create a long enough pool (~500+ lines)
  const repeated = (bgText + ' ◆ ').repeat(80)
  bgPrepared = prepareWithSegments(repeated, getBgFont())
  allLineRanges = []
  walkLineRanges(bgPrepared, vw, line => {
    allLineRanges.push({ start: line.start, end: line.end, width: line.width })
  })
  // Pre-materialize for fast non-obstacle rows
  allLineTexts = allLineRanges.map(lr => materializeLineRange(bgPrepared, lr).text)
}

// ── Frame measurement (sprite) ──
function measureAllFrames() {
  lineHeight = CHAR_FONT_SIZE
  measuredFrames = frames.map(lines => ({ lines }))

  ctx.font = getCharFont()
  const charWidth  = ctx.measureText('M').width
  const cols       = frames[0][0].length
  const rows       = frames[0].length
  globalMaxWidth   = charWidth * cols
  globalMaxHeight  = lineHeight * rows
}

// ── Sizing ──
function computeSize() {
  vw = window.innerWidth
  vh = window.innerHeight

  scale      = (vh * 0.28) / globalMaxHeight
  charScreenX = vw * 0.5
  charScreenY = vh * 0.5

  const dpr = window.devicePixelRatio || 1
  canvas.width        = vw * dpr
  canvas.height       = vh * dpr
  canvas.style.width  = `${vw}px`
  canvas.style.height = `${vh}px`
}

// ── Render background text: parallax + editorial obstacle avoidance ──
function renderBgText(charLeft, charRight, charTop, charBottom) {
  if (!bgPrepared || allLineRanges.length === 0) return

  const totalLines   = allLineRanges.length
  const numScreenRows = Math.ceil(vh / BG_LINE_HEIGHT) + 1

  ctx.font          = getBgFont()
  ctx.textBaseline  = 'top'

  for (let row = 0; row < numScreenRows; row++) {
    const screenY  = row * BG_LINE_HEIGHT
    const progress = screenY / vh   // 0 = top (far), 1 = bottom (near)

    // Parallax: top rows scroll slowest (far), bottom rows fastest (near)
    const parallaxFactor = PARALLAX_MIN + progress * (PARALLAX_MAX - PARALLAX_MIN)
    const linesScrolled  = timeOffset * BASE_LINES_PER_SEC * parallaxFactor
    const lineIdx        = ((Math.floor(linesScrolled) % totalLines) + totalLines) % totalLines

    // Depth: top = dim/small, bottom = bright/large
    const opacity = 0.12 + progress * 0.72
    ctx.fillStyle = `rgba(180, 230, 185, ${opacity})`

    const rowBottom   = screenY + BG_LINE_HEIGHT
    const overlapChar = screenY < charBottom && rowBottom > charTop

    if (overlapChar && allLineRanges[lineIdx]) {
      // ── Editorial engine: layout text around character rectangle ──
      // The character bounding box blocks [charLeft, charRight].
      // We lay out three segments: left visible, hidden (behind char), right visible.
      const startCursor = allLineRanges[lineIdx].start

      if (charLeft > 2) {
        // Left slot: text from 0 to charLeft
        const leftLine = layoutNextLine(bgPrepared, startCursor, charLeft)
        if (leftLine?.text) {
          ctx.fillText(leftLine.text, 0, screenY)
          // Advance cursor through the blocked region (text that falls under the character)
          const blockedWidth = Math.max(0, charRight - charLeft)
          if (blockedWidth > 0 && charRight < vw - 2) {
            const hiddenLine = layoutNextLine(bgPrepared, leftLine.end, blockedWidth)
            if (hiddenLine) {
              // Right slot: text continuing from after the blocked region
              const rightLine = layoutNextLine(bgPrepared, hiddenLine.end, vw - charRight)
              if (rightLine?.text) ctx.fillText(rightLine.text, charRight, screenY)
            }
          }
        }
      } else {
        // Character covers the left edge — only right slot
        const skipLine = layoutNextLine(bgPrepared, startCursor, charRight)
        if (skipLine) {
          const rightLine = layoutNextLine(bgPrepared, skipLine.end, vw - charRight)
          if (rightLine?.text) ctx.fillText(rightLine.text, charRight, screenY)
        }
      }
    } else {
      // Full-width row — use pre-materialized text (fast path)
      const text = allLineTexts[lineIdx]
      if (text) ctx.fillText(text, 0, screenY)
    }
  }
}

// ── Render frame ──
function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return

  const dpr = window.devicePixelRatio || 1

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Dark background
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, vw, vh)
  ctx.restore()

  // Character screen-space bounds
  const spriteW  = globalMaxWidth  * scale
  const spriteH  = globalMaxHeight * scale
  const charLeft  = charScreenX - spriteW / 2
  const charRight = charScreenX + spriteW / 2
  const charTop   = charScreenY - spriteH / 2
  const charBottom = charScreenY + spriteH / 2

  // Background text with parallax + obstacle avoidance
  ctx.save()
  ctx.scale(dpr, dpr)
  renderBgText(charLeft, charRight, charTop, charBottom)
  ctx.restore()

  // ASCII sprite (green, fixed at center)
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)
  ctx.font         = getCharFont()
  ctx.textBaseline = 'top'
  ctx.shadowColor  = GLOW_COLOR
  ctx.shadowBlur   = 10
  ctx.fillStyle    = TEXT_COLOR
  for (let row = 0; row < mf.lines.length; row++) {
    ctx.fillText(mf.lines[row], 0, row * lineHeight)
  }
  ctx.restore()
}

// ── Input ──
function startWalk(dir) {
  if (isWalking) return
  direction    = dir
  currentFrame = 0
  isWalking    = true
}

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') startWalk(1)
  else if (e.key === 'ArrowLeft')  startWalk(-1)
})

window.addEventListener('pointerdown', e => {
  if (e.clientX >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})

// ── Animation Loop ──
function animate(timestamp) {
  const interval = 1000 / FPS

  if (timestamp - lastFrameTime >= interval) {
    const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.1)
    timeOffset   += dt
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)

    if (isWalking) {
      currentFrame++
      if (currentFrame >= TOTAL_FRAMES) {
        isWalking    = false
        currentFrame = 0
      }
    }

    renderFrame(currentFrame)
  }

  requestAnimationFrame(animate)
}

// ── Resize ──
window.addEventListener('resize', () => {
  computeSize()
  preLayoutBgText()
  renderFrame(currentFrame)
})

// ── Init ──
async function init() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight

  await loadFont()
  measureAllFrames()
  computeSize()

  // Use default text immediately while news loads
  bgText = DEFAULT_BG_TEXT
  preLayoutBgText()

  lastFrameTime = performance.now()
  requestAnimationFrame(animate)

  // Fetch real news asynchronously
  fetchNews()
}

init()
