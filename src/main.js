import './style.css'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES   = frames.length
const TEXT_COLOR     = '#00ff40'
const GLOW_COLOR     = 'rgba(0, 255, 64, 0.55)'
const FPS            = 30
const CHAR_FONT_SIZE = 14
const CHAR_LINE_H    = CHAR_FONT_SIZE

const CHAR_X_FRAC       = 0.10
const TEXT_HORIZON_FRAC = 0.46
const CHAR_HEIGHT_FRAC  = 0.22

const FONT_MIN   = 9
const FONT_MAX   = 72
const LINE_MULT  = 1.25

const PARALLAX_MIN     = 0.06
const PARALLAX_MAX     = 1.80
const SCROLL_PER_FRAME = 8

// ── Canvas ──
const app    = document.getElementById('app')
const canvas = document.createElement('canvas')
app.appendChild(canvas)
const ctx = canvas.getContext('2d')

// ── State ──
let currentFrame  = 0
let lastFrameTime = 0
let isWalking     = false
let direction     = 1

let spriteCharW   = 0
let globalSpriteW = 0
let globalSpriteH = 0
let scale         = 1
let charScreenX   = 0
let charScreenY   = 0   // top of sprite in CSS-px
let vw = 0, vh = 0

let newsItems    = []
let textScrollX  = 0
let measuredFrames = []

const DEFAULT_NEWS = [
  '뉴스를 불러오는 중입니다 — 잠시 후 최신 속보가 표시됩니다.',
  'Fetching live news — latest breaking headlines will appear shortly.',
  'The web renders text through a pipeline designed thirty years ago for static documents.',
  'A browser loads a font, shapes text into glyphs, measures widths, determines line breaks.',
  'Pretext exploits canvas measureText to compute layout without any DOM reflows.',
  'Real-time text reflow around animated obstacles — every frame at thirty frames per second.',
  'Text information becomes abundant and cheap — query a thousand widths in microseconds.',
]

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
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return [...doc.querySelectorAll('item')].map(el => {
    const title = el.querySelector('title')?.textContent?.trim() ?? ''
    const desc  = (el.querySelector('description')?.textContent ?? '')
      .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    return [title, desc].filter(Boolean).join('. ')
  }).filter(t => t.length > 4)
}

async function tryFetch(url) {
  const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
  const body = await res.text()
  // allorigins wraps in JSON; corsproxy returns raw XML
  try { const j = JSON.parse(body); if (j.contents) return j.contents } catch (_) {}
  return body
}

async function fetchNews() {
  const feeds = [
    'https://www.yna.co.kr/rss/news.xml',
    'https://world.kbs.co.kr/rss/rss_korean.htm',
    'https://feeds.bbci.co.uk/korean/rss.xml',
  ]
  // corsproxy.io: raw URL after '?' — NO encodeURIComponent
  // allorigins: encoded URL in query param
  const wrappers = [
    url => `https://corsproxy.io/?${url}`,
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  ]

  for (const feed of feeds) {
    for (const wrap of wrappers) {
      try {
        const xml   = await tryFetch(wrap(feed))
        const items = parseRss(xml)
        if (items.length >= 3) {
          newsItems = items
          return
        }
      } catch (_) {}
    }
  }
  // keep DEFAULT_NEWS
}

// ── Sprite setup ──
function setupSprites() {
  measuredFrames = frames.map(lines => ({ lines }))
  ctx.font  = `${CHAR_FONT_SIZE}px "Geist Mono", monospace`
  spriteCharW   = ctx.measureText('M').width
  globalSpriteW = spriteCharW   * frames[0][0].length
  globalSpriteH = CHAR_LINE_H   * frames[0].length
}

// ── Sizing ──
function computeSize() {
  vw = window.innerWidth
  vh = window.innerHeight

  scale = (vh * CHAR_HEIGHT_FRAC) / globalSpriteH

  const horizonY = vh * TEXT_HORIZON_FRAC
  charScreenX    = vw * CHAR_X_FRAC
  // Sink the sprite so its bottom 18 % sits inside the text area,
  // creating real character-level collision rows for the legs/feet.
  charScreenY    = horizonY - globalSpriteH * scale * 0.82

  const dpr = window.devicePixelRatio || 1
  canvas.width        = vw * dpr
  canvas.height       = vh * dpr
  canvas.style.width  = `${vw}px`
  canvas.style.height = `${vh}px`
}

// ── Pixel-precise sprite collision ──
// Scans all non-space characters in the current frame that overlap
// the vertical band [bandTop, bandBottom] in screen space.
// Returns {left, right} screen-x interval or null.
//
// Character transform chain (see renderFrame):
//   ctx.translate(charScreenX, charScreenY)
//   ctx.scale(direction * scale, scale)
//   ctx.translate(-globalSpriteW / 2, 0)
// So for a local x:
//   screenX = charScreenX + (localX - globalSpriteW/2) * direction * scale
function spriteBlockedX(bandTop, bandBottom) {
  const mf = measuredFrames[currentFrame]
  if (!mf) return null

  const sprTop = charScreenY
  const sprBot = charScreenY + globalSpriteH * scale
  if (bandBottom <= sprTop || bandTop >= sprBot) return null

  let minX =  Infinity
  let maxX = -Infinity

  const lines = mf.lines
  for (let r = 0; r < lines.length; r++) {
    const rowTop = charScreenY + r       * CHAR_LINE_H * scale
    const rowBot = charScreenY + (r + 1) * CHAR_LINE_H * scale
    if (rowBot <= bandTop || rowTop >= bandBottom) continue

    const line = lines[r]
    for (let c = 0; c < line.length; c++) {
      if (line[c] === ' ') continue
      // Local x span of this glyph column
      const lx1 = c       * spriteCharW
      const lx2 = (c + 1) * spriteCharW
      // Map to screen (handles direction flip via sign of direction*scale)
      const sx1 = charScreenX + (lx1 - globalSpriteW / 2) * direction * scale
      const sx2 = charScreenX + (lx2 - globalSpriteW / 2) * direction * scale
      const lo  = Math.min(sx1, sx2)
      const hi  = Math.max(sx1, sx2)
      if (lo < minX) minX = lo
      if (hi > maxX) maxX = hi
    }
  }

  if (minX === Infinity) return null
  // Clamp to viewport
  return {
    left:  Math.max(0, minX),
    right: Math.min(vw, maxX),
  }
}

// ── Per-row perspective properties ──
function rowProps(screenY) {
  const horizonY = vh * TEXT_HORIZON_FRAC
  if (screenY < horizonY) return null
  const t        = (screenY - horizonY) / (vh - horizonY)   // 0 = far, 1 = near
  const fontSize = FONT_MIN + t * (FONT_MAX - FONT_MIN)
  const lineH    = fontSize * LINE_MULT
  const parallax = PARALLAX_MIN + t * (PARALLAX_MAX - PARALLAX_MIN)
  const opacity  = 0.20 + t * 0.75
  return { fontSize, lineH, parallax, opacity }
}

// ── Draw one tiled text row with optional collision split ──
// Editorial-engine approach: text fills every available slot,
// flowing without gap up to the actual character pixel boundary.
function drawRow(text, screenY, lineH, rowScrollX, opacity, fontSize, blocked) {
  ctx.font         = `${fontSize.toFixed(1)}px "Geist Mono", monospace`
  ctx.textBaseline = 'top'
  ctx.fillStyle    = `rgba(255, 255, 255, ${opacity})`

  const tileW = ctx.measureText(text).width
  if (tileW <= 0) return

  // Normalised start offset: 0 at rightmost, increasing → text moves left
  const off    = ((-rowScrollX % tileW) + tileW) % tileW
  const startX = -(tileW - off)   // first tile starts at or before x = 0

  function drawTiled(clipL, clipR) {
    if (clipR <= clipL) return
    ctx.save()
    ctx.beginPath()
    ctx.rect(clipL, screenY, clipR - clipL, lineH)
    ctx.clip()
    // Jump to the tile nearest to clipL
    let x = startX + Math.max(0, Math.floor((clipL - startX) / tileW) - 1) * tileW
    while (x < clipR) { ctx.fillText(text, x, screenY); x += tileW }
    ctx.restore()
  }

  if (blocked && blocked.right > blocked.left) {
    drawTiled(0, blocked.left)       // left slot
    drawTiled(blocked.right, vw)     // right slot
  } else {
    drawTiled(0, vw)
  }
}

// ── Render background text ──
function renderBgText() {
  const items    = newsItems.length ? newsItems : DEFAULT_NEWS
  const horizonY = vh * TEXT_HORIZON_FRAC
  let   screenY  = horizonY
  let   rowIndex = 0

  while (screenY < vh) {
    const p = rowProps(screenY)
    if (!p) { screenY += FONT_MIN * LINE_MULT; continue }
    const { fontSize, lineH, parallax, opacity } = p

    // Each row shows a different news item
    const text       = items[rowIndex % items.length]
    const rowScrollX = textScrollX * parallax

    // Pixel-precise collision: scan actual non-space glyph positions
    const blocked = spriteBlockedX(screenY, screenY + lineH)

    drawRow(text, screenY, lineH, rowScrollX, opacity, fontSize, blocked)

    screenY  += lineH
    rowIndex++
  }
}

// ── Render frame ──
function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return

  const dpr = window.devicePixelRatio || 1

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.fillStyle = '#080808'
  ctx.fillRect(0, 0, vw, vh)
  ctx.restore()

  // Background text first (sprite renders on top)
  ctx.save()
  ctx.scale(dpr, dpr)
  renderBgText()
  ctx.restore()

  // ASCII sprite
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalSpriteW / 2, 0)   // horizontal centre pivot
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

// ── Animation loop ──
function animate(ts) {
  const interval = 1000 / FPS
  if (ts - lastFrameTime >= interval) {
    lastFrameTime = ts - ((ts - lastFrameTime) % interval)
    if (isWalking) {
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
  newsItems = [...DEFAULT_NEWS]

  lastFrameTime = performance.now()
  requestAnimationFrame(animate)

  fetchNews()  // async — swaps in real news when ready
}

init()
