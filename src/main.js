import './style.css'
import { prepare, layout, prepareWithSegments, layoutNextLine } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const FPS = 30
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.15)'
const BG_TEXT_COLOR = '#ffffff'
const NEWS_RSS_URL = 'https://www.yna.co.kr/rss/news.xml'

// ── Parallax Layers (based on Figma metadata) ──
const LAYERS_CONFIG = [
  { y: 456, fontSize: 15, speed: 1.0 },
  { y: 476, fontSize: 15, speed: 1.2 },
  { y: 496, fontSize: 15, speed: 1.4 },
  { y: 516, fontSize: 15, speed: 1.6 },
  { y: 536, fontSize: 15, speed: 1.8 },
  { y: 556, fontSize: 15, speed: 2.0 },
  { y: 578, fontSize: 20, speed: 2.5 },
  { y: 605, fontSize: 30, speed: 3.5 },
  { y: 642, fontSize: 40, speed: 4.5 },
  { y: 689, fontSize: 50, speed: 6.0 },
  { y: 746, fontSize: 60, speed: 8.0 },
]

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let canvas, ctx
let isWalking = false
let direction = 1
let newsText = "연합뉴스 속보를 불러오는 중입니다..."
let newsChars = [] // Array of { char: string, width: number } for each layer
let layersState = [] // { scrollX: number }

// Character layout state
let charWidth = 0
let lineHeight = 14
let measuredFrames = []
let globalMaxWidth = 0
let globalMaxHeight = 0
let scale = 1
let charScreenX = 0
let charScreenY = 0

// ── News Fetching ──
async function fetchNews() {
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(NEWS_RSS_URL)}`
    const res = await fetch(proxyUrl)
    const data = await res.json()
    const parser = new DOMParser()
    const xml = parser.parseFromString(data.contents, 'text/xml')
    const items = xml.querySelectorAll('item')
    
    let combinedText = ""
    items.forEach(item => {
      const title = item.querySelector('title')?.textContent || ""
      const description = item.querySelector('description')?.textContent || ""
      combinedText += `[속보] ${title} : ${description} `.replace(/<[^>]*>?/gm, '')
    })
    
    newsText = combinedText.replace(/\s+/g, ' ').trim()
    if (!newsText) newsText = "뉴스를 가져오지 못했습니다. 잠시 후 다시 시도해주세요."
    
    preMeasureNews()
  } catch (err) {
    console.error('News fetch error:', err)
    newsText = "연합뉴스 데이터를 불러오는 데 실패했습니다."
    preMeasureNews()
  }
}

function preMeasureNews() {
  newsChars = LAYERS_CONFIG.map(config => {
    ctx.font = `${config.fontSize}px "Geist Mono", monospace`
    return newsText.split('').map(c => ({
      char: c,
      width: ctx.measureText(c).width
    }))
  })
}

// ── Collision / Slot Calculation ──
function getObstaclesForBand(bandTop, bandBottom, frameLines) {
  const spriteH = globalMaxHeight * scale
  const obY = charScreenY - spriteH / 2
  
  if (bandBottom <= obY || bandTop >= obY + spriteH) return []
  
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
        const localStartX = startIdx * charWidth - globalMaxWidth / 2
        const localEndX = i * charWidth - globalMaxWidth / 2
        
        let worldStartX, worldEndX
        if (direction === 1) {
          worldStartX = charScreenX + localStartX * scale
          worldEndX = charScreenX + localEndX * scale
        } else {
          worldStartX = charScreenX - localEndX * scale
          worldEndX = charScreenX - localStartX * scale
        }
        blocked.push({ left: worldStartX - 2, right: worldEndX + 2 })
      }
    }
  }
  return blocked
}

// ── Font Loading & Sizing ──
async function loadFont() {
  const font = new FontFace('Geist Mono', "url('https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff2')")
  await font.load().then(loaded => document.fonts.add(loaded)).catch(e => console.warn(e))
}

function measureAllFrames() {
  const font = `14px "Geist Mono", monospace`
  measuredFrames = frames.map(lines => {
    const text = lines.join('\n')
    const measured = prepare(text, font)
    const laid = layout(measured, Infinity, 14)
    return { lines, text, width: laid.width, height: laid.height }
  })
}

function computeSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  
  ctx.font = `14px "Geist Mono", monospace`
  charWidth = ctx.measureText('M').width
  
  const cols = frames[0][0].length
  const rows = frames[0].length
  globalMaxWidth = charWidth * cols
  globalMaxHeight = 14 * rows
  
  scale = (vh * 0.35) / globalMaxHeight
  charScreenX = vw * 0.25
  charScreenY = vh * 0.4 
  
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
  const vw = window.innerWidth
  const currentFrameLines = frames[idx]
  
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  // ── Render Parallax Layers ──
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'top'
  ctx.fillStyle = BG_TEXT_COLOR
  
  LAYERS_CONFIG.forEach((config, i) => {
    const chars = newsChars[i]
    if (!chars) return
    
    ctx.font = `${config.fontSize}px "Geist Mono", monospace`
    const obstacles = getObstaclesForBand(config.y, config.y + config.fontSize, currentFrameLines)
    
    // Virtual scroll offset
    let scrollX = layersState[i].scrollX
    
    // Starting X (tiled)
    let totalTextWidth = chars.reduce((sum, c) => sum + c.width, 0)
    if (totalTextWidth === 0) return
    
    // We want to render enough tiles to fill the screen
    // We start rendering from scrollX (could be negative)
    let drawX = (scrollX % totalTextWidth) - totalTextWidth
    
    while (drawX < vw) {
      for (let cInfo of chars) {
        // Collision check: if the character would be drawn inside an obstacle, skip/push it
        let isBlocked = false
        for (let b of obstacles) {
          if (drawX + cInfo.width > b.left && drawX < b.right) {
            drawX = b.right
            isBlocked = true
            break
          }
        }
        
        if (drawX >= vw) break
        
        ctx.fillText(cInfo.char, drawX, config.y)
        drawX += cInfo.width
      }
    }
  })
  
  ctx.restore()
  
  // ── Render Character ──
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)
  ctx.font = `14px "Geist Mono", monospace`
  ctx.textBaseline = 'top'
  ctx.shadowColor = GLOW_COLOR
  ctx.shadowBlur = 4
  ctx.fillStyle = TEXT_COLOR
  mf.lines.forEach((line, r) => ctx.fillText(line, 0, r * 14))
  ctx.restore()
}

// ── Animation Loop ──
function animate(timestamp) {
  const interval = 1000 / FPS
  if (timestamp - lastFrameTime >= interval) {
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)
    
    if (isWalking) {
      LAYERS_CONFIG.forEach((config, i) => {
        layersState[i].scrollX -= direction * config.speed
      })
      currentFrame++
      if (currentFrame >= TOTAL_FRAMES) {
        isWalking = false
        currentFrame = 0
      }
    }
    renderFrame(currentFrame)
  }
  requestAnimationFrame(animate)
}

// ── Input ──
function startWalk(dir) {
  if (isWalking) return
  direction = dir
  isWalking = true
  currentFrame = 0
}

window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') startWalk(1)
  else if (e.key === 'ArrowLeft') startWalk(-1)
})

window.addEventListener('pointerdown', e => {
  if (e.clientX >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})

window.addEventListener('resize', () => {
  computeSize()
  preMeasureNews()
  renderFrame(currentFrame)
})

// ── Init ──
async function init() {
  canvas = document.createElement('canvas')
  document.getElementById('app').innerHTML = ""
  document.getElementById('app').appendChild(canvas)
  ctx = canvas.getContext('2d')
  
  await loadFont()
  measureAllFrames()
  computeSize()
  
  LAYERS_CONFIG.forEach(() => layersState.push({ scrollX: 0 }))
  
  await fetchNews()
  requestAnimationFrame(animate)
}

init()
