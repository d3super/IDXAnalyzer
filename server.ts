import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Fetch Market Data (Yahoo Finance)
  app.get("/api/stock/:symbol", async (req, res) => {
    let { symbol } = req.params;
    if (!symbol) return res.status(400).json({ success: false, message: "Symbol is required" });

    symbol = symbol.toUpperCase();
    let yfSymbol = symbol;
    if (symbol === "IHSG" || symbol === "IDX") {
      yfSymbol = "^JKSE";
    } else if (!symbol.endsWith(".JK") && !symbol.startsWith("^")) {
      yfSymbol = `${symbol}.JK`;
    }

    const encodedSymbol = encodeURIComponent(yfSymbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=6mo`;

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        return res.status(response.status).json({ success: false, message: `Yahoo Finance error: ${response.statusText}` });
      }

      const json: any = await response.json();
      if (!json.chart.result || json.chart.result.length === 0) {
        return res.status(404).json({ success: false, message: "Symbol not found" });
      }

      const result = json.chart.result[0];
      const timestamps = result.timestamp;
      const quotes = result.indicators.quote[0];
      const adjClose = result.indicators.adjclose?.[0]?.adjclose || quotes.close;

      const data = timestamps.map((ts: number, i: number) => ({
        date: new Date(ts * 1000).toISOString().split('T')[0],
        open: quotes.open[i],
        high: quotes.high[i],
        low: quotes.low[i],
        close: quotes.close[i],
        adjClose: adjClose[i],
        volume: quotes.volume[i]
      })).filter((d: any) => d.close !== null);

      res.json({ success: true, symbol, data });
    } catch (error: any) {
      console.error("Fetch error:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static("dist"));
    app.get("*", (req, res) => {
      res.sendFile("dist/index.html", { root: "." });
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
