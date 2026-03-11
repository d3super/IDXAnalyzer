import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// Fetch Market Data (Yahoo Finance)
app.get("/api/stock/:symbol", async (req, res) => {
  let { symbol } = req.params;
  if (!symbol) return res.status(400).json({ success: false, message: "Symbol is required" });

  symbol = symbol.toUpperCase();
  let yfSymbol = symbol;
  
  // Handle IHSG and IDX specific symbols
  if (symbol === "IHSG" || symbol === "IDX") {
    yfSymbol = "^JKSE";
  } else if (!symbol.endsWith(".JK") && !symbol.startsWith("^")) {
    yfSymbol = `${symbol}.JK`;
  }

  const encodedSymbol = encodeURIComponent(yfSymbol);
  // Using a more reliable Yahoo Finance endpoint
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=6mo`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'application/json',
        'Referer': 'https://finance.yahoo.com/'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Yahoo API Error (${response.status}):`, errorText);
      return res.status(response.status).json({ 
        success: false, 
        message: `Market data provider returned ${response.status}: ${response.statusText}` 
      });
    }

    const json: any = await response.json();
    
    if (!json.chart?.result || json.chart.result.length === 0) {
      return res.status(404).json({ success: false, message: `Symbol ${symbol} not found or no data available.` });
    }

    const result = json.chart.result[0];
    const timestamps = result.timestamp;
    
    if (!timestamps || !result.indicators?.quote?.[0]) {
      return res.status(404).json({ success: false, message: "No historical data found for this symbol." });
    }

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
    })).filter((d: any) => d.close !== null && d.open !== null);

    if (data.length === 0) {
      return res.status(404).json({ success: false, message: "No valid data points found." });
    }

    res.json({ success: true, symbol, data });
  } catch (error: any) {
    console.error("Fetch error:", error);
    res.status(500).json({ success: false, message: "Internal server error while fetching market data." });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

export default app;
