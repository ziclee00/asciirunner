import './style.css'
import { prepare, layout } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.15)'
const BG_TEXT_COLOR = '#ffffff'

// Default background text (long single line, repeated)
const BG_TEXT_LINE = `The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one. This interactive ASCII player demonstrates dynamic text wrapping using the pretext library. The text layout engine computes the available space around the moving character in real-time, completely bypassing the browser's DOM layout engine. As you move the character left and right, the text seamlessly reflows around it at 60 frames per second. It treats the exact non-space regions of the ASCII sprite as collision obstacles. The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.`

// ── Inspector DOM ──
const fpsInput    = document.getElementById('fpsInput')
const scrollInput = document.getElementById('scrollInput')
const charSizeInput = document.getElementById('charSizeInput')
const bgSizeInput   = document.getElementById('bgSizeInput')

// ── Canvas Setup ──
const app = document.getElementById('app')
const canvas = document.createElement('canvas')
app.appendChild(canvas)
const ctx = canvas.getContext('2d')

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let isWalking = false
let direction = 1  // 1 = right, -1 = left

// Layout state
let charWidth = 0
let lineHeight = 0
let measuredFrames = []
let globalMaxWidth = 0
let globalMaxHeight = 0
let scale = 1

// Background scroll state — textOffsetX: how many px the text has scrolled
// positive = text moved right (character walked left)
// negative = text moved left (character walked right)
let textOffsetX = 0

// Fixed character screen position (center-left, vertically centered)
// will be set in computeSize
let charScreenX = 0
let charScreenY = 0

// ── Font helpers ──
function getFontSize() {
  return parseFloat(charSizeInput.value) || 14
}
function getBgFontSize() {
  return parseFloat(bgSizeInput.value) || 20
}
function getCharFont() {
  return `${getFontSize()}px "Geist Mono", monospace`
}
function getBgFont() {
  return `${getBgFontSize()}px "Geist Mono", monospace`
}

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

// ── Frame measurement ──
function measureAllFrames() {
  const font = getCharFont()
  measuredFrames = frames.map(lines => {
    const text = lines.join('\n')
    const measured = prepare(text, font)
    const laid = layout(measured, Infinity, lineHeight)
    return { lines, text, width: laid.width, height: laid.height }
  })
}

// ── Sizing ──
function computeSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const fontSize = getFontSize()
  const font = getCharFont()

  ctx.font = font
  charWidth = ctx.measureText('M').width
  lineHeight = fontSize

  const cols = frames[0][0].length
  const rows = frames[0].length
  globalMaxWidth  = charWidth * cols
  globalMaxHeight = lineHeight * rows

  // Scale to ~1/4 of screen height
  scale = (vh * 0.25) / globalMaxHeight

  // Character position: left-ish, vertically centered a bit above the text line
  charScreenX = vw * 0.25
  charScreenY = vh * 0.5

  const dpr = window.devicePixelRatio || 1
  canvas.width  = vw * dpr
  canvas.height = vh * dpr
  canvas.style.width  = `${vw}px`
  canvas.style.height = `${vh}px`
}

// ── Measure single-line background text width ──
// Returns the pixel width of the full BG_TEXT_LINE at current font
let cachedBgTextWidth = 0
function measureBgTextWidth() {
  ctx.font = getBgFont()
  cachedBgTextWidth = ctx.measureText(BG_TEXT_LINE).width
}

// ── Get Y position of the text line (just below character feet) ──
function getTextLineY() {
  const spriteH = globalMaxHeight * scale
  // bottom of character
  const charBottom = charScreenY + spriteH / 2
  const bgFontSize = getBgFontSize()
  // Put text at character's feet, aligned to baseline
  return charBottom
}

// ── Render ──
function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return

  const dpr = window.devicePixelRatio || 1
  const vw  = window.innerWidth
  const vh  = window.innerHeight

  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // ── Render scrolling background text ──
  const textY   = getTextLineY()
  const bgFont  = getBgFont()
  const bgFontSize = getBgFontSize()

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.font = bgFont
  ctx.textBaseline = 'top'
  ctx.fillStyle = BG_TEXT_COLOR

  // We render the long text line starting at textOffsetX.
  // To make it seamless/infinite we tile it.
  const tw = cachedBgTextWidth
  if (tw > 0) {
    // Find the first tile start that's ≤ 0 on screen
    let startX = (textOffsetX % tw) - tw
    while (startX < vw) {
      ctx.fillText(BG_TEXT_LINE, startX, textY)
      startX += tw
    }
  } else {
    ctx.fillText(BG_TEXT_LINE, textOffsetX, textY)
  }

  ctx.restore()

  // ── Render character (fixed position) ──
  ctx.save()
  ctx.scale(dpr, dpr)

  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)

  ctx.font = getCharFont()
  ctx.textBaseline = 'top'
  ctx.shadowColor = GLOW_COLOR
  ctx.shadowBlur  = 4
  ctx.fillStyle   = TEXT_COLOR

  for (let row = 0; row < mf.lines.length; row++) {
    ctx.fillText(mf.lines[row], 0, row * lineHeight)
  }

  ctx.restore()
}

// ── Trigger a walk cycle ──
function startWalk(dir) {
  if (isWalking) return
  direction    = dir
  currentFrame = 0
  isWalking    = true
}

// ── Input ──
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.key === 'ArrowRight') startWalk(1)
  else if (e.key === 'ArrowLeft') startWalk(-1)
})

window.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#inspector')) return
  if (e.clientX >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})

// Inspector font-size changes require re-measure
charSizeInput.addEventListener('change', () => {
  lineHeight = getFontSize()
  measureAllFrames()
  measureBgTextWidth()
  computeSize()
  renderFrame(currentFrame)
})
bgSizeInput.addEventListener('change', () => {
  measureBgTextWidth()
  renderFrame(currentFrame)
})

// ── Animation Loop ──
function animate(timestamp) {
  const fps = parseFloat(fpsInput.value) || 60
  const interval = 1000 / fps

  if (timestamp - lastFrameTime >= interval) {
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)

    if (isWalking) {
      // Scroll the background text in the opposite direction of travel
      const scrollPx = parseFloat(scrollInput.value) || 5
      textOffsetX -= direction * scrollPx  // right walk → text moves left

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
  measureBgTextWidth()
  computeSize()
  renderFrame(currentFrame)
})

// ── Init ──
async function init() {
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight

  await loadFont()

  lineHeight = getFontSize()
  measureAllFrames()
  measureBgTextWidth()
  computeSize()

  lastFrameTime = performance.now()
  requestAnimationFrame(animate)
}

init()
