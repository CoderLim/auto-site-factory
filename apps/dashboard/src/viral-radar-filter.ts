type ViralFilter = "all" | "accelerating" | "organic" | "media"

const FILTERS: ViralFilter[] = ["all", "accelerating", "organic", "media"]
const FILTER_LABELS: Record<ViralFilter, string> = {
  all: "全部 Viral 实体",
  accelerating: "正在加速",
  organic: "自然扩散",
  media: "媒体 / 爆发"
}

function stageFor(row: HTMLTableRowElement): string {
  return row.cells[2]?.textContent?.trim() ?? ""
}

function propagationFor(row: HTMLTableRowElement): string {
  return row.cells[3]?.textContent?.trim() ?? ""
}

function matches(row: HTMLTableRowElement, filter: ViralFilter): boolean {
  if (filter === "all") return true
  if (filter === "accelerating") return stageFor(row) === "ACCELERATING"
  if (filter === "organic") return propagationFor(row) === "自然扩散"
  return stageFor(row) === "MEDIA PICKUP" || stageFor(row) === "BREAKOUT"
}

function radarElements() {
  if (window.location.pathname !== "/discovery/viral") return null
  const section = document.querySelector<HTMLElement>("main > section")
  const stats = section?.querySelector<HTMLElement>(".stats")
  const tableCard = section?.querySelector<HTMLElement>(".table-card")
  const table = tableCard?.querySelector<HTMLTableElement>("table")
  if (!stats || !tableCard || !table) return null

  const cards = Array.from(stats.querySelectorAll<HTMLElement>(":scope > article"))
  const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody > tr"))
  if (cards.length !== 4) return null
  return { stats, tableCard, cards, rows }
}

export function installViralRadarCardFilters(): void {
  let activeFilter: ViralFilter = "all"
  let lastPath = window.location.pathname
  let frame = 0

  const apply = () => {
    frame = 0
    if (window.location.pathname !== lastPath) {
      activeFilter = "all"
      lastPath = window.location.pathname
    }

    const elements = radarElements()
    if (!elements) return
    const { stats, tableCard, cards, rows } = elements
    stats.classList.add("viral-stats")

    const counts: Record<ViralFilter, number> = {
      all: rows.length,
      accelerating: rows.filter((row) => matches(row, "accelerating")).length,
      organic: rows.filter((row) => matches(row, "organic")).length,
      media: rows.filter((row) => matches(row, "media")).length
    }

    cards.forEach((card, index) => {
      const filter = FILTERS[index]
      if (!filter) return
      card.classList.add("viral-stat-filterable")
      card.setAttribute("role", "button")
      card.setAttribute("tabindex", "0")
      card.setAttribute("aria-label", `筛选：${FILTER_LABELS[filter]}`)
      card.setAttribute("aria-pressed", String(activeFilter === filter))
      card.dataset.viralFilter = filter
      card.classList.toggle("active", activeFilter === filter)

      const count = card.querySelector("strong")
      const nextCount = String(counts[filter])
      if (count && count.textContent !== nextCount) count.textContent = nextCount
    })

    let visible = 0
    for (const row of rows) {
      const show = matches(row, activeFilter)
      row.hidden = !show
      if (show) visible += 1
    }

    const existingEmpty = tableCard.querySelector<HTMLElement>(".viral-filter-empty")
    if (activeFilter !== "all" && rows.length > 0 && visible === 0) {
      const empty = existingEmpty ?? document.createElement("div")
      empty.className = "empty viral-filter-empty"
      const text = `当前没有符合「${FILTER_LABELS[activeFilter]}」的候选。再次点击已选卡片可清除筛选。`
      if (empty.textContent !== text) empty.textContent = text
      if (!existingEmpty) tableCard.appendChild(empty)
    } else if (existingEmpty) {
      existingEmpty.remove()
    }
  }

  const scheduleApply = () => {
    if (frame) return
    frame = window.requestAnimationFrame(apply)
  }

  const activateCard = (card: HTMLElement) => {
    const next = card.dataset.viralFilter as ViralFilter | undefined
    if (!next) return
    activeFilter = next === "all" ? "all" : activeFilter === next ? "all" : next
    scheduleApply()
  }

  document.addEventListener("click", (event) => {
    if (window.location.pathname !== "/discovery/viral") return
    const target = event.target
    if (!(target instanceof Element)) return
    const card = target.closest<HTMLElement>(".viral-stat-filterable")
    if (card) activateCard(card)
  })

  document.addEventListener("keydown", (event) => {
    if (window.location.pathname !== "/discovery/viral") return
    if (event.key !== "Enter" && event.key !== " ") return
    const target = event.target
    if (!(target instanceof HTMLElement) || !target.classList.contains("viral-stat-filterable")) return
    event.preventDefault()
    activateCard(target)
  })

  const observer = new MutationObserver(scheduleApply)
  observer.observe(document.body, { childList: true, subtree: true })
  window.addEventListener("popstate", scheduleApply)
  scheduleApply()
}
