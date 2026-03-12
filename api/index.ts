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

    // --- IMPROVED FUNDAMENTALS FETCHING ---
    // We prioritize the 'quote' endpoint as it's much more reliable for IDX stocks on Cloud servers
    const quoteUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodedSymbol}`;
    const summaryUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodedSymbol}?modules=defaultKeyStatistics,financialData,assetProfile,summaryDetail`;
    
    let fundamentals: any = {
      pe: null,
      pbv: null,
      fcf: null,
      der: null,
      marketCap: null,
      sector: null,
      industry: null,
      dividendYield: null,
      eps: null
    };

    const fetchHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'application/json'
    };

    try {
      // Step 1: Fetch from Quote API (Fastest & Most Reliable)
      const quoteRes = await fetch(quoteUrl, { headers: fetchHeaders });
      if (quoteRes.ok) {
        const quoteJson: any = await quoteRes.json();
        const q = quoteJson.quoteResponse?.result?.[0];
        if (q) {
          fundamentals.pe = q.trailingPE || q.forwardPE || null;
          fundamentals.pbv = q.priceToBook || null;
          fundamentals.marketCap = q.marketCap || null;
          fundamentals.dividendYield = q.trailingAnnualDividendYield || null;
          fundamentals.eps = q.epsTrailingTwelveMonths || q.epsForward || null;
        }
      }

      // Step 2: Fetch from Summary API (For Sector, Industry, DER, FCF)
      // We do this separately to ensure if one fails, the other still provides data
      const summaryRes = await fetch(summaryUrl, { headers: fetchHeaders });
      if (summaryRes.ok) {
        const summaryJson: any = await summaryRes.json();
        const res = summaryJson.quoteSummary?.result?.[0];
        if (res) {
          // Fill missing fields
          if (!fundamentals.pe) fundamentals.pe = res.summaryDetail?.trailingPE?.raw || res.summaryDetail?.forwardPE?.raw || res.defaultKeyStatistics?.trailingPE?.raw || null;
          if (!fundamentals.pbv) fundamentals.pbv = res.defaultKeyStatistics?.priceToBook?.raw || res.summaryDetail?.priceToBook?.raw || null;
          if (!fundamentals.marketCap) fundamentals.marketCap = res.summaryDetail?.marketCap?.raw || null;
          
          fundamentals.fcf = res.financialData?.freeCashflow?.raw || null;
          fundamentals.der = res.financialData?.debtToEquity?.raw || null;
          fundamentals.sector = res.assetProfile?.sector || null;
          fundamentals.industry = res.assetProfile?.industry || null;
        }
      }
    } catch (e) {
      console.error("Fundamentals fetch error:", e);
    }

    // Fetch News (Yahoo Finance search) - Increased count to allow filtering
    // We search for the symbol + "Indonesia" to get more relevant local news
    const newsSearchQuery = symbol === "IHSG" ? "IHSG Indonesia" : `${symbol} Saham Indonesia`;
    const newsUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(newsSearchQuery)}&newsCount=25`;
    let news = [];

    try {
      const newsResponse = await fetch(newsUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Referer': 'https://finance.yahoo.com/'
        }
      });

      if (newsResponse.ok) {
        const newsJson: any = await newsResponse.json();
        const rawNews = newsJson.news || [];
        
        // Filter for specific Indonesian sources
        const allowedSources = [
          "Bloomberg Technoz", "Kontan", "IDNFinancials", "Investor.id", 
          "Investor Daily", "Bisnis.com", "CNBC Indonesia", "Detik", 
          "Kompas", "Tempo", "Antara", "Liputan6", "Sindonews", "Okezone"
        ];
        
        news = rawNews.filter((item: any) => {
          const publisher = item.publisher?.toLowerCase() || "";
          const title = item.title?.toLowerCase() || "";
          
          // Check if publisher is in our allowed list
          const isAllowedSource = allowedSources.some(source => publisher.includes(source.toLowerCase()));
          
          // Or if the title contains Indonesian keywords if it's a general source
          const hasIndoKeywords = title.includes("saham") || title.includes("idx") || title.includes("ihsg") || title.includes("rupiah");
          
          return isAllowedSource || (hasIndoKeywords && !publisher.includes("yahoo"));
        });

        // Limit and fallback
        if (news.length === 0) {
          news = rawNews.slice(0, 5);
        } else {
          news = news.slice(0, 8);
        }
      }
    } catch (e) {
      console.error("News fetch error:", e);
    }

    res.json({ success: true, symbol, data, fundamentals, news });
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
