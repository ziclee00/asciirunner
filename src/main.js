import './style.css'
import { prepare, layout, prepareWithSegments, layoutNextLine } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const FPS = 30
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.15)'
const NEWS_RSS_URL = 'https://www.yna.co.kr/rss/news.xml'

// ── Parallax Layers ──
// Updated opacity: 2-1. Bottom 100%, 2-2. -10% per layer up
const LAYERS_CONFIG = [
  { y: 456, fontSize: 15, speed: 1.0, opacity: 0.1 },
  { y: 476, fontSize: 15, speed: 1.2, opacity: 0.2 },
  { y: 496, fontSize: 15, speed: 1.4, opacity: 0.3 },
  { y: 516, fontSize: 15, speed: 1.6, opacity: 0.4 },
  { y: 536, fontSize: 15, speed: 1.8, opacity: 0.5 },
  { y: 556, fontSize: 15, speed: 2.0, opacity: 0.6 },
  { y: 578, fontSize: 20, speed: 2.5, opacity: 0.7 },
  { y: 605, fontSize: 30, speed: 3.5, opacity: 0.8 },
  { y: 642, fontSize: 40, speed: 4.5, opacity: 0.9 },
  { y: 689, fontSize: 50, speed: 6.0, opacity: 1.0 }, // Bottom (relative to Figma range)
  { y: 746, fontSize: 60, speed: 8.0, opacity: 1.0 }, // Bottom-most
]

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let canvas, ctx
let isWalking = false
let direction = 1
let newsArticles = [] // Array of strings
let layersState = [] // { scrollX: number, articleIndex: number }

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
  const refreshBtn = document.getElementById('refreshBtn')
  if (refreshBtn) refreshBtn.textContent = 'Refreshing...'
  
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(NEWS_RSS_URL)}`
    const res = await fetch(proxyUrl)
    const data = await res.json()
    const parser = new DOMParser()
    const xml = parser.parseFromString(data.contents, 'text/xml')
    const items = xml.querySelectorAll('item')
    
    newsArticles = []
    items.forEach(item => {
      const title = item.querySelector('title')?.textContent || ""
      const description = item.querySelector('description')?.textContent || ""
      const article = `[속보] ${title} : ${description} `.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim()
      if (article) newsArticles.push(article)
    })
    
    if (newsArticles.length === 0) newsArticles = ["뉴스를 불러오지 못했습니다."]
    
    // Assign random news to each layer
    layersState.forEach(layer => {
      layer.articleIndex = Math.floor(Math.random() * newsArticles.length)
    })
    
  } catch (err) {
    console.error('News fetch error:', err)
    newsArticles = ["뉴스 데이터를 불러오는 데 실패했습니다."]
  } finally {
    if (refreshBtn) refreshBtn.textContent = 'News Refresh'
  }
}

// ── Collision / Obstacle Calculation ──
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
        blocked.push({ left: worldStartX - 5, right: worldEndX + 5 })
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
  
  // 1. 축소: 기존 0.35에서 0.7 곱함 (~0.24)
  scale = (vh * 0.35 * 0.7) / globalMaxHeight
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
  
  LAYERS_CONFIG.forEach((config, i) => {
    const state = layersState[i]
    const article = newsArticles[state.articleIndex % newsArticles.length] || newsArticles[0]
    if (!article) return
    
    ctx.font = `${config.fontSize}px "Geist Mono", monospace`
    ctx.globalAlpha = config.opacity // Apply opacity gradient
    ctx.fillStyle = '#ffffff'
    
    const obstacles = getObstaclesForBand(config.y, config.y + config.fontSize, currentFrameLines)
    
    // Measure full width
    const textWidth = ctx.measureText(article).width
    if (totalTextWidth === 0) return
    
    // Tiling logic with CLIPPING (no reflow)
    let drawX = (state.scrollX % textWidth) - textWidth
    
    // 3. 충돌 삭제 및 클리핑 처리
    // We can use a simple trick: clip the entire line drawing by the "inverse" of the obstacles
    ctx.save()
    if (obstacles.length > 0) {
      // Instead of complex path clipping, we'll just draw segments that are outside obstacles
      // This is easier for single line tiling
    }
    
    while (drawX < vw) {
      // Draw the text, but skip parts that are blocked
      // To simplify "overlapping text deletion", we use clearRect on the character areas later 
      // or just draw in non-blocked segments.
      
      // Let's use the segment drawing approach:
      let currentX = drawX
      // Actually, fillText article at currentX is fine if we later "mask" the character
      ctx.fillText(article, currentX, config.y)
      drawX += textWidth
    }
    
    // Mask character areas for this layer
    ctx.globalAlpha = 1.0
    ctx.fillStyle = '#000000'
    obstacles.forEach(b => {
      ctx.fillRect(b.left, config.y, b.right - b.left, config.fontSize)
    })
    
    ctx.restore()
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
  if (e.target.closest('#refreshBtn')) return
  if (e.clientX >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})

document.getElementById('refreshBtn').addEventListener('click', () => {
  fetchNews()
})

window.addEventListener('resize', () => {
  computeSize()
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
  
  LAYERS_CONFIG.forEach(() => layersState.push({ scrollX: 0, articleIndex: 0 }))
  
  await fetchNews()
  requestAnimationFrame(animate)
}

init()
