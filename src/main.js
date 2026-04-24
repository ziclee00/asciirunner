import './style.css'
import { prepare, layout, prepareWithSegments, layoutNextLine } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const FONT_SIZE = 14
const FONT = `${FONT_SIZE}px "Geist Mono", monospace`
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.15)'

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let canvas, ctx
let scale = 1
let charWidth = 0
let lineHeight = 0
let measuredFrames = []
let globalMaxWidth = 0
let globalMaxHeight = 0

// Animation state
let isWalking = false
let direction = 1 // 1 for right, -1 for left (flip)
let charX = window.innerWidth / 2

// Background text state
const DEFAULT_TEXT = `The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.
The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.
The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.
The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.
The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.
The web renders text through a pipeline that was designed thirty years ago for static documents. A browser loads a font, shapes the text into glyphs, measures their combined width, determines where lines break, and positions each line vertically. Every step depends on the previous one.


This interactive ASCII player demonstrates dynamic text wrapping using the pretext library. The text layout engine computes the available space around the moving character in real-time, completely bypassing the browser's DOM layout engine. 

As you move the character left and right, the text seamlessly reflows around it at 60 frames per second. It treats the exact non-space regions of the ASCII sprite as collision obstacles.`

let bgTextRaw = DEFAULT_TEXT
let preparedBgText = null
const BG_TEXT_COLOR = '#ffffff'
const BG_FONT = `20pt "Geist Mono", monospace`
const BG_LINE_HEIGHT = 32

// ── DOM Setup ──
const app = document.getElementById('app')
canvas = document.createElement('canvas')
app.appendChild(canvas)
ctx = canvas.getContext('2d')
const speedInput = document.getElementById('speedInput')
const fpsInput = document.getElementById('fpsInput')
const urlInput = document.getElementById('urlInput')
const fetchBtn = document.getElementById('fetchBtn')
const bgTextInput = document.getElementById('bgTextInput')

// ── Background Layout Engine ──
function carveTextLineSlots(base, blocked) {
  let slots = [base]
  for (let blockedIndex = 0; blockedIndex < blocked.length; blockedIndex++) {
    const interval = blocked[blockedIndex]
    const next = []
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      const slot = slots[slotIndex]
      if (interval.right <= slot.left || interval.left >= slot.right) {
        next.push(slot)
        continue
      }
      if (interval.left > slot.left) next.push({ left: slot.left, right: interval.left })
      if (interval.right < slot.right) next.push({ left: interval.right, right: slot.right })
    }
    slots = next
  }
  return slots.filter(slot => slot.right - slot.left >= 30) // min slot width
}

function getObstaclesForBand(bandTop, bandBottom, frameLines) {
  const charY = window.innerHeight / 2
  const obH = globalMaxHeight * scale
  const obY = charY - obH / 2
  
  if (bandBottom <= obY || bandTop >= obY + obH) return []
  
  const localYTop = (bandTop - obY) / scale
  const localYBottom = (bandBottom - obY) / scale
  
  const rowStart = Math.max(0, Math.floor(localYTop / lineHeight))
  const rowEnd = Math.min(frameLines.length - 1, Math.floor(localYBottom / lineHeight))
  
  const blocked = []
  
  for (let r = rowStart; r <= rowEnd; r++) {
    const lineStr = frameLines[r]
    if (!lineStr) continue
    
    let inWord = false
    let startIdx = 0
    for (let i = 0; i <= lineStr.length; i++) {
      const isSpace = i === lineStr.length || lineStr[i] === ' '
      if (!isSpace && !inWord) {
        inWord = true
        startIdx = i
      } else if (isSpace && inWord) {
        inWord = false
        const endIdx = i // exclusive
        
        const localStartX = startIdx * charWidth - globalMaxWidth / 2
        const localEndX = endIdx * charWidth - globalMaxWidth / 2
        
        let worldStartX, worldEndX
        if (direction === 1) {
          worldStartX = charX + localStartX * scale
          worldEndX = charX + localEndX * scale
        } else {
          worldStartX = charX - localEndX * scale
          worldEndX = charX - localStartX * scale
        }
        
        const pad = 10
        blocked.push({ left: worldStartX - pad, right: worldEndX + pad })
      }
    }
  }
  return blocked
}

function layoutBackgroundText() {
  if (!preparedBgText) return []
  
  const vw = window.innerWidth
  const vh = window.innerHeight
  
  const lines = []
  let cursor = { segmentIndex: 0, graphemeIndex: 0 }
  let lineTop = 0
  let textExhausted = false
  
  const currentFrameLines = frames[currentFrame]
  
  while (lineTop + BG_LINE_HEIGHT <= vh && !textExhausted) {
    const bandTop = lineTop
    const bandBottom = lineTop + BG_LINE_HEIGHT
    
    const blocked = getObstaclesForBand(bandTop, bandBottom, currentFrameLines)
    
    const slots = carveTextLineSlots({ left: 0, right: vw }, blocked)
    if (slots.length === 0) {
      lineTop += BG_LINE_HEIGHT
      continue
    }
    
    slots.sort((a, b) => a.left - b.left)
    
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i]
      const slotWidth = slot.right - slot.left
      const line = layoutNextLine(preparedBgText, cursor, slotWidth)
      
      if (line === null) {
        textExhausted = true
        break
      }
      
      lines.push({
        x: Math.round(slot.left),
        y: Math.round(lineTop),
        text: line.text,
        width: line.width
      })
      cursor = line.end
    }
    
    lineTop += BG_LINE_HEIGHT
  }
  
  return lines
}

// ── Font Loading ──
async function loadFont() {
  try {
    const font = new FontFace(
      'Geist Mono',
      "url('https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff2')"
    )
    const loadedFont = await font.load()
    document.fonts.add(loadedFont)
  } catch (e) {
    console.warn('Geist Mono load failed, using monospace fallback:', e)
  }
}

// ── Use pretext to measure text bounds for precise layout ──
function measureAllFrames() {
  measuredFrames = frames.map(lines => {
    const text = lines.join('\n')
    const measured = prepare(text, FONT)
    const laid = layout(measured, Infinity, lineHeight)
    return {
      lines,
      text,
      width: laid.width,
      height: laid.height,
    }
  })
}

// ── Sizing ──
function computeSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight

  ctx.font = FONT
  charWidth = ctx.measureText('M').width
  lineHeight = FONT_SIZE

  // Fix bounding box based on grid columns to prevent wobbling & jumping on flip
  const cols = frames[0][0].length
  const rows = frames[0].length
  globalMaxWidth = charWidth * cols
  globalMaxHeight = lineHeight * rows

  const padX = 60
  const padY = 60
  const scaleX = (vw - padX) / globalMaxWidth
  const scaleY = (vh - padY) / globalMaxHeight
  // Reduce scale to 1/4 of the optimal fit size
  scale = Math.min(scaleX, scaleY, 5) * 0.25

  const dpr = window.devicePixelRatio || 1
  canvas.width = vw * dpr
  canvas.height = vh * dpr
  canvas.style.width = `${vw}px`
  canvas.style.height = `${vh}px`
}

// ── Render ──
function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return

  const dpr = window.devicePixelRatio || 1

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // --- Render Background Text ---
  if (preparedBgText) {
    const bgLines = layoutBackgroundText()
    ctx.save()
    ctx.scale(dpr, dpr)
    ctx.font = BG_FONT
    ctx.textBaseline = 'top'
    ctx.fillStyle = BG_TEXT_COLOR
    for (let i = 0; i < bgLines.length; i++) {
      const line = bgLines[i]
      ctx.fillText(line.text, line.x, line.y)
    }
    ctx.restore()
  }

  ctx.save()

  // Move to character position (centered vertically)
  const charY = window.innerHeight / 2
  ctx.translate(charX * dpr, charY * dpr)
  
  // Apply scaling and flip direction
  ctx.scale(direction * scale * dpr, scale * dpr)

  // Offset by half character size to center rendering at charX, charY
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)

  ctx.font = FONT
  ctx.textBaseline = 'top'
  ctx.shadowColor = GLOW_COLOR
  ctx.shadowBlur = 4
  ctx.fillStyle = TEXT_COLOR

  for (let row = 0; row < mf.lines.length; row++) {
    ctx.fillText(mf.lines[row], 0, row * lineHeight)
  }

  ctx.restore()
}

// ── Input Handling ──
function updateBackgroundText() {
  bgTextRaw = bgTextInput.value
  if (bgTextRaw.trim().length > 0) {
    preparedBgText = prepareWithSegments(bgTextRaw, BG_FONT)
  } else {
    preparedBgText = null
  }
}

bgTextInput.addEventListener('input', () => {
  updateBackgroundText()
  renderFrame(currentFrame)
})

fetchBtn.addEventListener('click', async () => {
  const url = urlInput.value
  if (!url) return
  
  fetchBtn.textContent = 'Fetching...'
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`
    const res = await fetch(proxyUrl)
    const data = await res.json()
    
    const parser = new DOMParser()
    const doc = parser.parseFromString(data.contents, 'text/html')
    doc.querySelectorAll('script, style, noscript, iframe, svg').forEach(el => el.remove())
    const text = doc.body.textContent.replace(/\s+/g, ' ').trim()
    
    bgTextInput.value = text
    updateBackgroundText()
    renderFrame(currentFrame)
  } catch (err) {
    console.error('Fetch error:', err)
    alert('Failed to fetch URL. Ensure it is valid.')
  } finally {
    fetchBtn.textContent = 'Fetch'
  }
})

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return // Ignore when typing
  
  if (isWalking) return // Ignore if already playing
  
  if (e.key === 'ArrowRight') {
    isWalking = true
    direction = 1
    currentFrame = 0
  } else if (e.key === 'ArrowLeft') {
    isWalking = true
    direction = -1
    currentFrame = 0
  }
})

window.addEventListener('pointerdown', (e) => {
  // Ignore clicks on UI elements
  if (e.target.closest('#inspector')) return
  
  if (isWalking) return // Ignore if already playing
  
  if (e.clientX < window.innerWidth / 2) {
    isWalking = true
    direction = -1
    currentFrame = 0
  } else {
    isWalking = true
    direction = 1
    currentFrame = 0
  }
})
// ── Animation Loop ──
function animate(timestamp) {
  const currentFPS = parseFloat(fpsInput.value) || 60
  const interval = 1000 / currentFPS

  if (timestamp - lastFrameTime >= interval) {
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)
    
    if (isWalking) {
      // Move X coordinate by n px depending on direction
      const speed = parseFloat(speedInput.value) || 10
      charX += speed * direction

      currentFrame++
      
      // Stop walking when animation cycle completes
      if (currentFrame >= TOTAL_FRAMES) {
        isWalking = false
        currentFrame = 0 // Reset to walk_00_d (default pose)
      }
    }
    
    // Always render to maintain the canvas state
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
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  ctx.font = '16px monospace'
  ctx.fillStyle = TEXT_COLOR
  ctx.fillText('Loading Geist Mono...', 20, 40)

  await loadFont()

  lineHeight = FONT_SIZE
  measureAllFrames()
  computeSize()

  bgTextInput.value = bgTextRaw
  updateBackgroundText()

  lastFrameTime = performance.now()
  requestAnimationFrame(animate)
}

init()
