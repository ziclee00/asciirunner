import './style.css'
import { prepare, layout, prepareWithSegments, layoutNextLine } from '@chenglou/pretext'
import { frames } from './frames.js'

// ── Configuration ──
const TOTAL_FRAMES = frames.length
const FPS = 30
const TEXT_COLOR = '#00ff40'
const GLOW_COLOR = 'rgba(0, 255, 64, 0.05)' 
const NEWS_RSS_URL = 'https://www.yna.co.kr/rss/news.xml'

// ── New Layer Structure ──
const FLOOR_LAYERS = [
  { fontSize: 20, speed: 1.5, opacity: 0.6 },
  { fontSize: 30, speed: 2.5, opacity: 0.7 },
  { fontSize: 40, speed: 4.0, opacity: 0.8 },
  { fontSize: 50, speed: 6.5, opacity: 0.9 },
  { fontSize: 60, speed: 9.5, opacity: 1.0 },
]

const WALL_LAYERS = [
  { fontSize: 15, speed: 0.8, opacity: 0.2 },
  { fontSize: 15, speed: 0.8, opacity: 0.2 },
  { fontSize: 15, speed: 0.8, opacity: 0.2 },
  { fontSize: 15, speed: 0.8, opacity: 0.2 },
  { fontSize: 15, speed: 0.8, opacity: 0.2 },
]

let allLayersConfig = []
let layersState = []

// ── State ──
let currentFrame = 0
let lastFrameTime = 0
let canvas, ctx
let isWalking = false
let direction = 1
let newsArticles = ["뉴스를 불러오는 중입니다...", "연합뉴스 실시간 속보 수신 중..."]

// Character config
let charFontSize = 10 // 10pt로 다시 축소
let charWidth = 0
let lineHeight = charFontSize
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
        const data = await res.json(); text = data.contents;
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
        success = true; break;
      }
    } catch (err) { console.warn('Proxy failed...') }
  }
  if (refreshBtn) refreshBtn.textContent = 'News Refresh'
}

function updateLayersContent() {
  layersState.forEach((state, i) => {
    state.articleIndex = Math.floor(Math.random() * newsArticles.length)
    const config = allLayersConfig[i]
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
  const font = `${charFontSize}px "Geist Mono", monospace`
  measuredFrames = frames.map(lines => {
    const text = lines.join('\n')
    const measured = prepare(text, font)
    const laid = layout(measured, Infinity, charFontSize)
    return { lines, text, width: laid.width, height: laid.height }
  })
}

function computeSize() {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const isMobile = vw < 600
  ctx.font = `${charFontSize}px "Geist Mono", monospace`
  charWidth = ctx.measureText('M').width
  const cols = frames[0][0].length
  const rows = frames[0].length
  globalMaxWidth = charWidth * cols
  globalMaxHeight = charFontSize * rows
  scale = 1.0 
  charScreenX = isMobile ? 60 : 180 
  let currentY = vh
  const floorConfig = FLOOR_LAYERS.slice().reverse().map(base => {
    const spacing = base.fontSize * 0.15
    currentY -= (base.fontSize + spacing)
    return { ...base, y: currentY, type: 'floor' }
  }).reverse()
  let wallY = floorConfig[0].y
  const wallConfig = WALL_LAYERS.slice().reverse().map(base => {
    const spacing = 10
    wallY -= (base.fontSize + spacing)
    return { ...base, y: wallY, type: 'wall' }
  }).reverse()
  allLayersConfig = [...wallConfig, ...floorConfig]
  const charH = globalMaxHeight * scale
  charScreenY = floorConfig[0].y - (charH / 2) - 2
  
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.floor(vw * dpr)
  canvas.height = Math.floor(vh * dpr)
  canvas.style.width = `${vw}px`
  canvas.style.height = `${vh}px`
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0) 
  
  updateLayersContent()
}

// ── Render ──
function drawLayer(config, state) {
  const vw = window.innerWidth
  const article = newsArticles[state.articleIndex % newsArticles.length]
  if (!article || !state.measuredChars) return
  ctx.font = `${config.fontSize}px "Geist Mono", monospace`
  ctx.globalAlpha = config.opacity
  ctx.fillStyle = '#ffffff'
  const totalW = state.measuredChars.reduce((s, c) => s + c.width, 0)
  if (totalW === 0) return
  let drawX = (state.scrollX % totalW)
  if (drawX > 0) drawX -= totalW
  while (drawX < vw) {
    for (let cInfo of state.measuredChars) {
      if (drawX >= vw) break
      ctx.fillText(cInfo.char, drawX, config.y)
      drawX += cInfo.width
    }
  }
}

function renderFrame(idx) {
  const mf = measuredFrames[idx]
  if (!mf) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  
  ctx.save()
  ctx.textBaseline = 'top'

  allLayersConfig.forEach((config, i) => {
    if (config.type === 'wall') drawLayer(config, layersState[i])
  })

  ctx.save()
  ctx.globalAlpha = 1.0 
  ctx.translate(charScreenX, charScreenY)
  ctx.scale(direction * scale, scale)
  ctx.translate(-globalMaxWidth / 2, -globalMaxHeight / 2)
  ctx.font = `${charFontSize}px "Geist Mono", monospace`
  ctx.shadowBlur = 0 
  ctx.fillStyle = TEXT_COLOR
  mf.lines.forEach((line, r) => {
    ctx.fillText(line, 0, r * charFontSize)
  })
  ctx.restore()

  allLayersConfig.forEach((config, i) => {
    if (config.type === 'floor') drawLayer(config, layersState[i])
  })
  ctx.restore()
}

// ── Loop ──
function animate(timestamp) {
  const interval = 1000 / FPS
  if (timestamp - lastFrameTime >= interval) {
    lastFrameTime = timestamp - ((timestamp - lastFrameTime) % interval)
    if (isWalking) {
      allLayersConfig.forEach((config, i) => {
        layersState[i].scrollX -= direction * config.speed
      })
      currentFrame = (currentFrame + 1) % TOTAL_FRAMES
    } else { currentFrame = 0 }
    renderFrame(currentFrame)
  }
  requestAnimationFrame(animate)
}

const activeInputs = new Set()
function updateWalkingState() { isWalking = activeInputs.size > 0 }
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowRight') { direction = 1; activeInputs.add('right'); }
  if (e.key === 'ArrowLeft') { direction = -1; activeInputs.add('left'); }
  updateWalkingState()
})
window.addEventListener('keyup', e => {
  if (e.key === 'ArrowRight') activeInputs.delete('right')
  if (e.key === 'ArrowLeft') activeInputs.delete('left')
  updateWalkingState()
})
window.addEventListener('pointerdown', e => {
  if (e.target.closest('#refreshBtn')) return
  const x = e.clientX; if (x >= window.innerWidth / 2) { direction = 1; activeInputs.add('pointer'); } else { direction = -1; activeInputs.add('pointer'); }
  updateWalkingState()
})
window.addEventListener('pointerup', () => { activeInputs.delete('pointer'); updateWalkingState(); })
window.addEventListener('pointerleave', () => { activeInputs.delete('pointer'); updateWalkingState(); })
document.getElementById('refreshBtn').addEventListener('click', e => { e.stopPropagation(); fetchNews(); })
window.addEventListener('resize', () => { computeSize(); renderFrame(currentFrame); })

async function init() {
  const app = document.getElementById('app'); if (!app) return
  canvas = document.createElement('canvas'); app.innerHTML = ""; app.appendChild(canvas); ctx = canvas.getContext('2d')
  await loadFont(); measureAllFrames()
  for (let i = 0; i < 10; i++) layersState.push({ scrollX: 0, articleIndex: 0, measuredChars: [] })
  computeSize(); renderFrame(0); fetchNews(); requestAnimationFrame(animate)
}
init()
