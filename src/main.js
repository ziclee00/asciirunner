import './style.css'
import { prepare, layout, prepareWithSegments, layoutNextLine } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const FPS = 30
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.15)'
const NEWS_RSS_URL = 'https://www.yna.co.kr/rss/news.xml'

// ── Parallax Layers Definition ──
// We'll define base sizes and speeds. Y positions will be calculated from the bottom.
const LAYERS_BASE = [
  { fontSize: 14, speed: 1.0, opacity: 0.1 },
  { fontSize: 14, speed: 1.2, opacity: 0.2 },
  { fontSize: 14, speed: 1.4, opacity: 0.3 },
  { fontSize: 14, speed: 1.6, opacity: 0.4 },
  { fontSize: 14, speed: 1.8, opacity: 0.5 },
  { fontSize: 18, speed: 2.2, opacity: 0.6 },
  { fontSize: 24, speed: 3.0, opacity: 0.7 },
  { fontSize: 32, speed: 4.2, opacity: 0.8 },
  { fontSize: 42, speed: 5.8, opacity: 0.9 },
  { fontSize: 52, speed: 7.8, opacity: 1.0 },
  { fontSize: 65, speed: 10.5, opacity: 1.0 },
]

let layersConfig = [] // Will hold calculated { y, fontSize, speed, opacity }

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let canvas, ctx
let isWalking = false
let direction = 1
let newsArticles = ["뉴스를 불러오는 중입니다...", "연합뉴스 실시간 속보 수신 중..."]
let layersState = [] // { scrollX, articleIndex, measuredChars }

let charWidth = 0
let lineHeight = 14
let measuredFrames = []
let globalMaxWidth = 0
let globalMaxHeight = 0
let scale = 1
let charScreenX = 180 
let charScreenY = 0

// ── News Fetching ──
async function fetchNews() {
  const refreshBtn = document.getElementById('refreshBtn')
  if (refreshBtn) refreshBtn.textContent = 'Refreshing...'
  const proxies = [
    url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`
  ]
  let success = false
  for (const getProxyUrl of proxies) {
    try {
      const res = await fetch(getProxyUrl(NEWS_RSS_URL))
      let text = ""
      if (res.url.includes('allorigins')) {
        const data = await res.json()
        text = data.contents
      } else { text = await res.text() }
      const parser = new DOMParser()
      const xml = parser.parseFromString(text, 'text/xml')
      const items = xml.querySelectorAll('item')
      const fetched = []
      items.forEach(item => {
        const title = item.querySelector('title')?.textContent || ""
        const description = item.querySelector('description')?.textContent || ""
        const article = `[속보] ${title} : ${description} `.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim()
        if (article) fetched.push(article)
      })
      if (fetched.length > 0) {
        newsArticles = fetched
        updateLayersContent()
        success = true
        break 
      }
    } catch (err) { console.warn('Proxy failed...') }
  }
  if (refreshBtn) refreshBtn.textContent = 'News Refresh'
}

function updateLayersContent() {
  layersState.forEach((state, i) => {
    state.articleIndex = Math.floor(Math.random() * newsArticles.length)
    const config = layersConfig[i]
    if (!config) return
    ctx.font = `${config.fontSize}px "Geist Mono", monospace`
    const article = newsArticles[state.articleIndex % newsArticles.length]
    state.measuredChars = article.split('').map(c => ({
      char: c,
      width: ctx.measureText(c).width
    }))
  })
}

// ── Setup ──
async function loadFont() {
  const font = new FontFace('Geist Mono', "url('https://cdn.jsdelivr.net/fontsource/fonts/geist-mono@latest/latin-400-normal.woff2')")
  try { await font.load(); document.fonts.add(font); } catch (e) { console.warn(e) }
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
  const isMobile = vw < 600
  
  ctx.font = `14px "Geist Mono", monospace`
  charWidth = ctx.measureText('M').width
  const cols = frames[0][0].length
  const rows = frames[0].length
  globalMaxWidth = charWidth * cols
  globalMaxHeight = 14 * rows
  
  // Mobile adjustments
  const baseScale = isMobile ? 0.45 : 0.35
  scale = (vh * baseScale * 0.5) / globalMaxHeight
  charScreenX = isMobile ? 60 : 180 // Move closer to edge on mobile
  
  // 1. 하단 공백 제거: 최하단부터 레이어 계산
  let currentY = vh
  layersConfig = LAYERS_BASE.slice().reverse().map(base => {
    // We add some spacing between layers based on font size
    const spacing = base.fontSize * 0.2
    currentY -= (base.fontSize + spacing)
    return { ...base, y: currentY }
  }).reverse()
  
  // Position character feet above the first layer (which is at layersConfig[0].y)
  const charH = globalMaxHeight * scale
  charScreenY = layersConfig[0].y - (charH / 2) - 5
  
  const dpr = window.devicePixelRatio || 1
  canvas.width = vw * dpr
  canvas.height = vh * dpr
  canvas.style.width = `${vw}px`
  canvas.style.height = `${vh}px`
  
  updateLayersContent()
}

// ── Render ──
function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return
  const dpr = window.devicePixelRatio || 1
  const vw = window.innerWidth
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.textBaseline = 'top'
  layersConfig.forEach((config, i) => {
    const state = layersState[i]
    if (!state || !state.measuredChars || state.measuredChars.length === 0) return
    ctx.font = `${config.fontSize}px "Geist Mono", monospace`
    ctx.globalAlpha = config.opacity
    ctx.fillStyle = '#ffffff'
    const totalW = state.measuredChars.reduce((s, c) => s + c.width, 0)
    let drawX = (state.scrollX % totalW)
    if (drawX > 0) drawX -= totalW
    while (drawX < vw) {
      for (let cInfo of state.measuredChars) {
        if (drawX >= vw) break
        ctx.fillText(cInfo.char, drawX, config.y)
        drawX += cInfo.width
      }
    }
  })
  ctx.restore()
  
  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)
  ctx.font = `14px "Geist Mono", monospace`
  ctx.textBaseline = 'top'
  ctx.shadowColor = GLOW_COLOR
  ctx.shadowBlur = 10
  ctx.fillStyle = TEXT_COLOR
  mf.lines.forEach((line, r) => ctx.fillText(line, 0, r * 14))
  ctx.restore()
}

// ── Loop ──
function animate(timestamp) {
  const interval = 1000 / FPS
  if (timestamp - lastFrameTime >= interval) {
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)
    if (isWalking) {
      layersConfig.forEach((config, i) => {
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
  // Handle multi-touch or simple click
  const x = e.clientX || (e.touches && e.touches[0].clientX)
  if (x >= window.innerWidth / 2) startWalk(1)
  else startWalk(-1)
})
document.getElementById('refreshBtn').addEventListener('click', e => {
  e.stopPropagation()
  fetchNews()
})
window.addEventListener('resize', () => { computeSize(); renderFrame(currentFrame); })

async function init() {
  const app = document.getElementById('app')
  if (!app) return
  canvas = document.createElement('canvas')
  app.innerHTML = ""
  app.appendChild(canvas)
  ctx = canvas.getContext('2d')
  await loadFont()
  measureAllFrames()
  LAYERS_BASE.forEach(() => layersState.push({ scrollX: 0, articleIndex: 0, measuredChars: [] }))
  computeSize()
  renderFrame(0)
  fetchNews()
  requestAnimationFrame(animate)
}
init()
