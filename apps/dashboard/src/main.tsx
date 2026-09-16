import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { GlobalLoadingOverlay, installGlobalLoadingFetch } from "./global-loading"
import { installViralRadarCardFilters } from "./viral-radar-filter"
import "./styles.css"
import "./keywords.css"
import "./viral-radar.css"

installGlobalLoadingFetch()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <GlobalLoadingOverlay />
  </StrictMode>
)
installViralRadarCardFilters()
