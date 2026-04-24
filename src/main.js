import './style.css'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES  = frames.length
const TEXT_COLOR    = '#00ff40'
const GLOW_COLOR    = 'rgba(0, 255, 64, 0.55)'
const FPS           = 30
const CHAR_FONT_SIZE = 14
const CHAR_LINE_H   = CHAR_FONT_SIZE

// Character: x at left-ish, feet sit exactly on the text horizon
const CHAR_X_FRAC       = 0.10   // screen-width fraction
const TEXT_HORIZON_FRAC = 0.46   // Y fraction where text "ground" starts
const CHAR_HEIGHT_FRAC  = 0.22   // character height as fraction of screen height

// Perspective text
const FONT_MIN   = 9    // px at horizon (far)
const FONT_MAX   = 72   // px at bottom  (near)
const LINE_MULT  = 1.25

// Parallax (applied per row when walking)
const PARALLAX_MIN   = 0.06   // top-row multiplier (slow / far)
const PARALLAX_MAX   = 1.80   // bottom-row multiplier (fast / near)
const SCROLL_PER_FRAME = 8    // base pixels scrolled per animation frame

// ── Canvas ──
const app    = document.getElementById('app')
const canvas = document.createElement('canvas')
app.appendChild(canvas)
const ctx = canvas.getContext('2d')

// ── Sprite state ──
let currentFrame = 0
let lastFrameTime = 0
let isWalking    = false
let direction    = 1          // 1 = right, -1 = left

let spriteCharW   = 0
let globalSpriteW = 0
let globalSpriteH = 0
let scale         = 1
let charScreenX   = 0
let charScreenY   = 0  // vertical center of sprite
let vw = 0, vh = 0

// ── Background text state ──
let bgText     = ''
let textScrollX = 0  // cumulative horizontal scroll (px at full parallax = 1.0)

const DEFAULT_BG_TEXT =
  '연합뉴스 속보. 최신 뉴스를 불러오는 중입니다. ' +
  'The web renders text through a pipeline designed thirty years ago for static documents. ' +
  'A browser loads a font shapes the text into glyphs measures their combined width ' +
  'determines where lines break and positions each line vertically. ' +
  'Every step depends on the previous one. '

// ── Frame data ──
let measuredFrames = []

// ── Font loading ──
async function loadFont() {
  try {
    const f = new FontFace(
      'Geist Mono',
      "url('https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff2')"
    )
    document.fonts.add(await f.load())
  } catch (_) {}
}

// ── News fetch ──
function parseRss(xml) {
  const doc   = new DOMParser().parseFromString(xml, 'application/xml')
  return [...doc.querySelectorAll('item')].map(el => {
    const title = el.querySelector('title')?.textContent?.trim() ?? ''
    const desc  = (el.querySelector('description')?.textContent ?? '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return [title, desc].filter(Boolean).join('. ')
  })
}

async function fetchNews() {
  const feeds = [
    'https://www.yna.co.kr/rss/news.xml',
    'https://world.kbs.co.kr/rss/rss_korean.htm',
  ]
  for (const url of feeds) {
    try {
      const res   = await fetch(`https://corsproxy.io/?${encodeURIComponent(url)}`,
        { signal: AbortSignal.timeout(8000) })
      const items = parseRss(await res.text())
      if (items.length) { bgText = items.join(' ◆ '); break }
    } catch (_) {}
  }
  if (!bgText) bgText = DEFAULT_BG_TEXT
}

// ── Sprite setup ──
function setupSprites() {
  measuredFrames = frames.map(lines => ({ lines }))
  ctx.font   = `${CHAR_FONT_SIZE}px "Geist Mono", monospace`
  spriteCharW    = ctx.measureText('M').width
  globalSpriteW  = spriteCharW * frames[0][0].length
  globalSpriteH  = CHAR_LINE_H  * frames[0].length
}

// ── Sizing ──
function computeSize() {
  vw = window.innerWidth
  vh = window.innerHeight

  // Scale so sprite height = CHAR_HEIGHT_FRAC * vh
  scale = (vh * CHAR_HEIGHT_FRAC) / globalSpriteH

  // Sprite feet land exactly on the text horizon
  const feetY = vh * TEXT_HORIZON_FRAC
  charScreenX  = vw * CHAR_X_FRAC
  charScreenY  = feetY - (globalSpriteH * scale) / 2  // center above feet

  const dpr = window.devicePixelRatio || 1
  canvas.width        = vw * dpr
  canvas.height       = vh * dpr
  canvas.style.width  = `${vw}px`
  canvas.style.height = `${vh}px`
}

// ── Per-row perspective helpers ──
// Returns null for rows above the text horizon.
function rowProps(screenY) {
  const horizonY = vh * TEXT_HORIZON_FRAC
  if (screenY < horizonY) return null
  const t        = (screenY - horizonY) / (vh - horizonY)  // 0=far, 1=near
  const fontSize = FONT_MIN + t * (FONT_MAX - FONT_MIN)
  const lineH    = fontSize * LINE_MULT
  const parallax = PARALLAX_MIN + t * (PARALLAX_MAX - PARALLAX_MIN)
  const opacity  = 0.20 + t * 0.75
  return { fontSize, lineH, parallax, opacity }
}

// ── Render background ──
function renderBgText(charL, charR, charT, charB) {
  if (!bgText) return

  const repeatStr = bgText + '  ◆  '
  const horizonY  = vh * TEXT_HORIZON_FRAC
  let   screenY   = horizonY

  while (screenY < vh) {
    const p = rowProps(screenY)
    if (!p) { screenY += FONT_MIN * LINE_MULT; continue }
    const { fontSize, lineH, parallax, opacity } = p

    ctx.font         = `${fontSize.toFixed(1)}px "Geist Mono", monospace`
    ctx.textBaseline = 'top'
    ctx.fillStyle    = `rgba(255, 255, 255, ${opacity})`

    const rowW = ctx.measureText(repeatStr).width
    // Raw scroll × per-row parallax factor; invert so right-walk = text moves left
    const rawOff = ((textScrollX * parallax) % rowW + rowW) % rowW

    const rowB = screenY + lineH
    const overlapChar = screenY < charB && rowB > charT

    if (overlapChar) {
      // Left clip region
      if (charL > 0) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(0, screenY, charL, lineH)
        ctx.clip()
        let x = -rawOff
        while (x < charL) { ctx.fillText(repeatStr, x, screenY); x += rowW }
        ctx.restore()
      }
      // Right clip region
      if (charR < vw) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(charR, screenY, vw - charR, lineH)
        ctx.clip()
        let x = charR - rawOff
        while (x < vw) { ctx.fillText(repeatStr, x, screenY); x += rowW }
        ctx.restore()
      }
    } else {
      let x = -rawOff
      while (x < vw) { ctx.fillText(repeatStr, x, screenY); x += rowW }
    }

    screenY += lineH
  }
}

// ── Render one animation frame ──
function renderFrame(idx) {
  const mf  = measuredFrames[idx]
  if (!mf) return

  const dpr = window.devicePixelRatio || 1

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, vw, vh)
  ctx.restore()

  // Sprite bounding box in CSS pixels
  const sprW  = globalSpriteW * scale
  const sprH  = globalSpriteH * scale
  const charL = charScreenX - sprW / 2
  const charR = charScreenX + sprW / 2
  const charT = charScreenY
  const charB = charScreenY + sprH

  // Background text
  ctx.save()
  ctx.scale(dpr, dpr)
  renderBgText(charL, charR, charT, charB)
  ctx.restore()

  // ASCII sprite
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalSpriteW / 2, 0)   // pivot: top-center
  ctx.font         = `${CHAR_FONT_SIZE}px "Geist Mono", monospace`
  ctx.textBaseline = 'top'
  ctx.shadowColor  = GLOW_COLOR
  ctx.shadowBlur   = 10
  ctx.fillStyle    = TEXT_COLOR
  for (let r = 0; r < mf.lines.length; r++) {
    ctx.fillText(mf.lines[r], 0, r * CHAR_LINE_H)
  }
  ctx.restore()
}

// ── Walk trigger ──
function startWalk(dir) {
  if (isWalking) return
  direction    = dir
  currentFrame = 0
  isWalking    = true
}

// ── Input ──
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') startWalk(1)
  else if (e.key === 'ArrowLeft')  startWalk(-1)
})

window.addEventListener('pointerdown', e => {
  if (e.clientX >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})

// ── Animation loop ──
function animate(ts) {
  const interval = 1000 / FPS

  if (ts - lastFrameTime >= interval) {
    lastFrameTime = ts - ((ts - lastFrameTime) % interval)

    if (isWalking) {
      // right walk (direction=1) → text flows left (scrollX decreases)
      textScrollX  -= direction * SCROLL_PER_FRAME
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
  renderFrame(currentFrame)
})

// ── Init ──
async function init() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight

  await loadFont()
  setupSprites()
  computeSize()
  bgText = DEFAULT_BG_TEXT

  lastFrameTime = performance.now()
  requestAnimationFrame(animate)

  fetchNews()
}

init()
