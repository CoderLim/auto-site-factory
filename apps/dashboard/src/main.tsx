import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import App from "./App"
import { installViralRadarCardFilters } from "./viral-radar-filter"
import "./styles.css"
import "./keywords.css"
import "./viral-radar.css"

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>)
installViralRadarCardFilters()
