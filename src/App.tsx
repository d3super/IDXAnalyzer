import React, { useState, useEffect, useMemo } from 'react';
import Chart from 'react-apexcharts';
import { Search, TrendingUp, TrendingDown, BarChart3, PieChart, Activity, Info, AlertCircle, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Technical Indicators Logic ---
function calculateSMA(data: number[], period: number) {
  const sma = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(null);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

function calculateEMA(data: number[], period: number) {
  const ema = [];
  const k = 2 / (period + 1);
  let prevEma = data[0];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      ema.push(prevEma);
    } else {
      const currentEma = data[i] * k + prevEma * (1 - k);
      ema.push(currentEma);
      prevEma = currentEma;
    }
  }
  return ema;
}

function calculateMACD(data: number[]) {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macdLine = ema12.map((v, i) => (v !== null && ema26[i] !== null ? v - ema26[i] : null));
  const validMacd = macdLine.filter((v): v is number => v !== null);
  const signalLineValid = calculateEMA(validMacd, 9);
  
  const signalLine = new Array(macdLine.length).fill(null);
  const offset = macdLine.length - signalLineValid.length;
  for (let i = 0; i < signalLineValid.length; i++) {
    signalLine[i + offset] = signalLineValid[i];
  }

  const histogram = macdLine.map((v, i) => (v !== null && signalLine[i] !== null ? v - signalLine[i] : null));
  return { macdLine, signalLine, histogram };
}

function calculateRSI(data: number[], period: number = 14) {
  const rsi = new Array(data.length).fill(null);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    if (i <= period) {
      if (diff > 0) gains += diff;
      else losses -= diff;
      if (i === period) {
        gains /= period;
        losses /= period;
        rsi[i] = 100 - 100 / (1 + gains / (losses || 1));
      }
    } else {
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;
      gains = (gains * (period - 1) + gain) / period;
      losses = (losses * (period - 1) + loss) / period;
      rsi[i] = 100 - 100 / (1 + gains / (losses || 1));
    }
  }
  return rsi;
}

// --- Components ---

const Card = ({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) => (
  <div className={cn("bg-zinc-900/50 border border-zinc-800 rounded-2xl p-6 overflow-hidden", className)}>
    {title && <h3 className="text-sm font-medium text-zinc-400 mb-4 uppercase tracking-wider">{title}</h3>}
    {children}
  </div>
);

const Stat = ({ label, value, subValue, trend }: { label: string; value: string | number; subValue?: string; trend?: 'up' | 'down' }) => (
  <div className="flex flex-col">
    <span className="text-xs text-zinc-500 uppercase tracking-widest mb-1">{label}</span>
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
      {trend && (
        <span className={cn("text-xs font-medium flex items-center gap-0.5", trend === 'up' ? "text-emerald-400" : "text-rose-400")}>
          {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {subValue}
        </span>
      )}
    </div>
  </div>
);

// --- Main App ---

export default function App() {
  const [search, setSearch] = useState('');
  const [symbol, setSymbol] = useState('IHSG');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockData, setStockData] = useState<any>(null);
  const [ihsgData, setIhsgData] = useState<any>(null);
  const [aiInsights, setAiInsights] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const fetchStock = async (sym: string, isIhsg = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/${sym}`);
      const data = await res.json();
      if (data.success) {
        if (isIhsg) setIhsgData(data);
        else setStockData(data);
      } else {
        setError(data.message || "Failed to fetch market data.");
      }
    } catch (err: any) {
      console.error("Fetch error:", err);
      setError("Network error: Could not connect to the analysis server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStock('IHSG', true);
  }, []);

  useEffect(() => {
    const generateAiInsights = async () => {
      if (!stockData?.symbol) {
        setAiInsights(null);
        return;
      }

      setAiLoading(true);
      try {
        // Prepare news context from backend if available
        const newsContext = stockData.news && stockData.news.length > 0 
          ? stockData.news.map((n: any) => `- ${n.title}`).join('\n')
          : "Tidak ada berita spesifik dari feed Yahoo.";

        const cleanSymbol = stockData.symbol.replace('.JK', '');
        const prompt = `Analisa sentimen pasar TERBARU dan INSTAN untuk saham ${cleanSymbol} (${stockData.symbol}) di Bursa Efek Indonesia (IDX).
        
        Tugas Anda:
        1. Gunakan Google Search untuk mencari berita paling baru (hari ini/minggu ini) mengenai "${cleanSymbol} saham Indonesia" atau "${cleanSymbol} IDX news".
        2. Fokus HANYA pada sumber berita terpercaya dari Indonesia (CNBC Indonesia, Kontan, Bisnis.com, Detik Finance, dll).
        3. Gabungkan dengan konteks berita berikut (jika relevan):
        ${newsContext}
        
        Berikan output dalam format JSON murni dengan struktur:
        {
          "summary": "Rangkuman sentimen berita terbaru dalam 1-2 kalimat bahasa Indonesia",
          "insights": ["Insight spesifik 1", "Insight spesifik 2"],
          "recommendation": "BUY/HOLD/SELL",
          "reason": "Alasan singkat rekomendasi berdasarkan berita dan sentimen terkini"
        }
        
        Pastikan analisa sangat spesifik terhadap kondisi pasar modal Indonesia saat ini.`;

        const response = await genAI.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: { 
            responseMimeType: "application/json",
            tools: [{ googleSearch: {} }]
          }
        });

        const result = JSON.parse(response.text || '{}');
        setAiInsights(result);
      } catch (err) {
        console.error("AI Insight error:", err);
        setAiInsights(null);
      } finally {
        setAiLoading(false);
      }
    };

    generateAiInsights();
  }, [stockData?.symbol]); // Only trigger when symbol changes to avoid redundant calls

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      setSymbol(search.toUpperCase());
      fetchStock(search.toUpperCase());
    }
  };

  const analysis = useMemo(() => {
    if (!stockData || !stockData.data.length) return null;
    const prices = stockData.data.map((d: any) => d.close);
    const lastPrice = prices[prices.length - 1];
    const prevPrice = prices[prices.length - 2];
    const change = lastPrice - prevPrice;
    const changePercent = (change / prevPrice) * 100;

    const rsi = calculateRSI(prices);
    const lastRsi = rsi[rsi.length - 1];
    
    const sma20 = calculateSMA(prices, 20);
    const lastSma20 = sma20[sma20.length - 1];

    const macd = calculateMACD(prices);
    const lastMacd = macd.macdLine[macd.macdLine.length - 1];
    const lastSignal = macd.signalLine[macd.signalLine.length - 1];

    // Support & Resistance (Last 20 days)
    const recentData = stockData.data.slice(-20);
    const support = Math.min(...recentData.map((d: any) => d.low));
    const resistance = Math.max(...recentData.map((d: any) => d.high));
    
    // Trading Plan Logic
    const stopLoss = support * 0.97; // 3% below support
    const entryPrice = lastPrice;
    const risk = entryPrice - stopLoss;
    const takeProfit = entryPrice + (risk * 2); // Risk/Reward 1:2

    // Scoring logic
    let score = 50;
    let insights = [];

    if (lastRsi < 30) {
      score += 20;
      insights.push("Kondisi Oversold (RSI < 30) menunjukkan potensi rebound teknikal.");
    } else if (lastRsi > 70) {
      score -= 20;
      insights.push("Kondisi Overbought (RSI > 70) menunjukkan risiko koreksi harga.");
    } else {
      insights.push(`RSI berada di level netral (${lastRsi.toFixed(2)}).`);
    }

    if (lastPrice > lastSma20) {
      score += 15;
      insights.push("Harga berada di atas SMA 20, mengonfirmasi tren jangka pendek yang bullish.");
    } else {
      score -= 10;
      insights.push("Harga berada di bawah SMA 20, waspadai tekanan jual jangka pendek.");
    }

    if (lastMacd && lastSignal && lastMacd > lastSignal) {
      score += 15;
      insights.push("MACD Golden Cross terdeteksi, sinyal momentum positif.");
    } else {
      insights.push("MACD menunjukkan momentum yang cenderung melemah atau bearish.");
    }

    if (lastPrice > resistance * 0.98) {
      insights.push("Harga mendekati area resistance kuat. Waspadai aksi profit taking.");
    } else if (lastPrice < support * 1.02) {
      insights.push("Harga berada di area support kuat. Potensi akumulasi beli.");
    }

    let signal = "HOLD";
    if (score > 70) signal = "STRONG BUY";
    else if (score > 60) signal = "BUY";
    else if (score < 30) signal = "STRONG SELL";
    else if (score < 40) signal = "SELL";

    return {
      lastPrice,
      change,
      changePercent,
      score,
      signal,
      rsi: lastRsi,
      sma20: lastSma20,
      macd: { line: lastMacd, signal: lastSignal },
      tradingPlan: {
        support,
        resistance,
        entry: entryPrice,
        stopLoss,
        takeProfit
      },
      insights
    };
  }, [stockData]);

  const chartOptions = (id: string, height: number, type: any = 'line') => ({
    chart: {
      id,
      group: 'stock-charts',
      type,
      height,
      toolbar: { show: false },
      animations: { enabled: false },
      background: 'transparent',
      foreColor: '#71717a'
    },
    xaxis: {
      type: 'datetime',
      labels: { show: id === 'rsi' },
      axisBorder: { show: false },
      axisTicks: { show: false },
      tooltip: { enabled: false }
    },
    yaxis: {
      labels: {
        show: id !== 'volume',
        minWidth: 40,
        formatter: (val: number) => val?.toFixed(id === 'volume' ? 0 : 2)
      },
      opposite: true
    },
    dataLabels: { enabled: false },
    grid: {
      borderColor: '#27272a',
      strokeDashArray: 4,
      xaxis: { lines: { show: true } }
    },
    stroke: { width: 2, curve: 'smooth' },
    tooltip: { theme: 'dark', x: { format: 'dd MMM yyyy' } },
    colors: ['#3b82f6', '#10b981', '#f43f5e', '#f59e0b']
  });

  const renderCharts = () => {
    if (!stockData) return null;
    const data = stockData.data;
    const closes = data.map((d: any) => d.close);
    const sma20 = calculateSMA(closes, 20);
    const rsi = calculateRSI(closes);
    const macd = calculateMACD(closes);

    const fundamentals = stockData.fundamentals;

    const formatFCF = (val: number | null) => {
      if (val === null) return "N/A";
      const absVal = Math.abs(val);
      if (absVal >= 1e12) return `${(val / 1e12).toFixed(2)} T`;
      if (absVal >= 1e9) return `${(val / 1e9).toFixed(2)} B`;
      if (absVal >= 1e6) return `${(val / 1e6).toFixed(2)} M`;
      return val.toLocaleString('id-ID');
    };

    return (
      <div className="space-y-4">
        {/* Fundamental Indicators */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Market Cap</span>
            <span className="text-lg font-bold text-zinc-100">{formatFCF(fundamentals?.marketCap)}</span>
          </Card>
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">PE Ratio</span>
            <span className="text-lg font-bold text-zinc-100">{fundamentals?.pe?.toFixed(2) || "N/A"}</span>
          </Card>
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">PBV</span>
            <span className="text-lg font-bold text-zinc-100">{fundamentals?.pbv?.toFixed(2) || "N/A"}</span>
          </Card>
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">FCF</span>
            <span className="text-lg font-bold text-zinc-100">{formatFCF(fundamentals?.fcf)}</span>
          </Card>
          <Card className="p-4 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">Debt/Equity</span>
            <span className="text-lg font-bold text-zinc-100">{fundamentals?.der ? `${fundamentals.der.toFixed(2)}%` : "N/A"}</span>
          </Card>
        </div>
        
        {fundamentals?.sector && (
          <div className="flex gap-4 text-[10px] text-zinc-500 uppercase tracking-widest px-2">
            <span>Sector: <span className="text-zinc-300">{fundamentals.sector}</span></span>
            <span>Industry: <span className="text-zinc-300">{fundamentals.industry}</span></span>
          </div>
        )}

        {/* Candlestick + SMA */}
        <Card className="p-2">
          <Chart
            options={{
              ...chartOptions('candle', 350, 'candlestick'),
              stroke: { width: [1, 2] },
              plotOptions: {
                candlestick: {
                  colors: { upward: '#10b981', downward: '#f43f5e' }
                }
              }
            } as any}
            series={[
              {
                name: 'Price',
                type: 'candlestick',
                data: data.map((d: any) => ({ x: d.date, y: [d.open, d.high, d.low, d.close] }))
              },
              {
                name: 'SMA 20',
                type: 'line',
                data: data.map((d: any, i: number) => ({ x: d.date, y: sma20[i] }))
              }
            ]}
            type="line"
            height={350}
          />
        </Card>

        {/* Volume */}
        <Card className="p-2">
          <Chart
            options={{
              ...chartOptions('volume', 150, 'bar'),
              colors: ['#3f3f46'],
              plotOptions: { bar: { columnWidth: '80%' } }
            } as any}
            series={[{ name: 'Volume', data: data.map((d: any) => ({ x: d.date, y: d.volume })) }]}
            type="bar"
            height={150}
          />
        </Card>

        {/* MACD */}
        <Card className="p-2">
          <Chart
            options={{
              ...chartOptions('macd', 150),
              colors: ['#3b82f6', '#f59e0b', '#71717a'],
              stroke: { width: [2, 2, 0] }
            } as any}
            series={[
              { name: 'MACD', type: 'line', data: data.map((d: any, i: number) => ({ x: d.date, y: macd.macdLine[i] })) },
              { name: 'Signal', type: 'line', data: data.map((d: any, i: number) => ({ x: d.date, y: macd.signalLine[i] })) },
              { name: 'Hist', type: 'bar', data: data.map((d: any, i: number) => ({ x: d.date, y: macd.histogram[i] })) }
            ]}
            type="line"
            height={150}
          />
        </Card>

        {/* RSI */}
        <Card className="p-2">
          <Chart
            options={{
              ...chartOptions('rsi', 150),
              colors: ['#a855f7'],
              yaxis: { min: 0, max: 100, tickAmount: 2, opposite: true },
              annotations: {
                yAxis: [
                  { y: 30, borderColor: '#10b981', strokeDashArray: 4 },
                  { y: 70, borderColor: '#f43f5e', strokeDashArray: 4 }
                ]
              }
            } as any}
            series={[{ name: 'RSI', data: data.map((d: any, i: number) => ({ x: d.date, y: rsi[i] })) }]}
            type="line"
            height={150}
          />
        </Card>

        {/* AI Insight & Rekomendasi */}
        <Card title="AI Insight & Rekomendasi (Berdasarkan Berita)">
          {aiLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="animate-spin text-blue-500 mb-2" size={24} />
              <p className="text-xs text-zinc-500">Menganalisa berita dengan AI...</p>
            </div>
          ) : aiInsights ? (
            <div className="space-y-6">
              <div className="flex items-start gap-3 bg-blue-500/5 border border-blue-500/10 p-4 rounded-xl">
                <Sparkles className="text-blue-400 shrink-0" size={18} />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-blue-400 uppercase tracking-wider">Sentimen Pasar</h4>
                  <p className="text-sm text-zinc-300 leading-relaxed">{aiInsights.summary}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Key Insights</h4>
                  <ul className="space-y-2">
                    {aiInsights.insights?.map((item: string, i: number) => (
                      <li key={i} className="flex gap-2 text-xs text-zinc-400 leading-relaxed">
                        <div className="w-1 h-1 rounded-full bg-zinc-600 mt-1.5 shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-zinc-800/30 p-4 rounded-xl border border-zinc-800 space-y-3">
                  <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Rekomendasi Berita</h4>
                  <div className="flex items-center justify-between">
                    <span className={cn(
                      "text-xl font-black tracking-tighter",
                      aiInsights.recommendation === 'BUY' ? "text-emerald-400" : 
                      aiInsights.recommendation === 'SELL' ? "text-rose-400" : "text-amber-400"
                    )}>
                      {aiInsights.recommendation}
                    </span>
                    <div className="text-[10px] text-zinc-500 italic text-right max-w-[150px]">
                      {aiInsights.reason}
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-zinc-800">
                <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-3">Sumber Berita Terkait</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {stockData.news?.slice(0, 4).map((item: any, i: number) => (
                    <a 
                      key={i} 
                      href={item.link} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 p-2 hover:bg-zinc-800/50 rounded-lg transition-colors group"
                    >
                      {item.thumbnail?.resolutions?.[0]?.url ? (
                        <img src={item.thumbnail.resolutions[0].url} alt="" className="w-10 h-10 rounded object-cover grayscale group-hover:grayscale-0 transition-all" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-10 h-10 bg-zinc-800 rounded flex items-center justify-center"><Info size={14} className="text-zinc-600" /></div>
                      )}
                      <div className="min-w-0">
                        <p className="text-[10px] text-zinc-300 font-medium truncate">{item.title}</p>
                        <p className="text-[8px] text-zinc-500">{item.publisher}</p>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 italic py-8 text-center">Tidak ada insight AI yang tersedia saat ini.</p>
          )}
        </Card>
      </div>
    );
  };

  return (
    <div className="min-h-screen font-sans selection:bg-blue-500/30">
      {/* Navigation */}
      <nav className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <Activity className="text-white" size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight">IDX<span className="text-blue-500">Analyzer</span></span>
          </div>

          <form onSubmit={handleSearch} className="flex-1 max-w-md mx-8 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text"
              placeholder="Search symbol (e.g. BBCA, GOTO)..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-full py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>

          <div className="flex items-center gap-4">
            <button onClick={() => fetchStock('IHSG', true)} className="p-2 hover:bg-zinc-900 rounded-lg transition-colors">
              <RefreshCw size={20} className={cn(loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Market Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <Card className="md:col-span-2 flex flex-col justify-between">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h2 className="text-2xl font-bold">IHSG Overview</h2>
                <p className="text-zinc-500 text-sm">Indonesia Stock Exchange Composite Index</p>
              </div>
              {ihsgData && (
                <div className="text-right">
                  <div className="text-3xl font-bold tracking-tighter">
                    {ihsgData.data[ihsgData.data.length - 1].close.toLocaleString('id-ID')}
                  </div>
                  <div className={cn("text-sm font-medium", (ihsgData.data[ihsgData.data.length - 1].close - ihsgData.data[ihsgData.data.length - 2].close) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {((ihsgData.data[ihsgData.data.length - 1].close - ihsgData.data[ihsgData.data.length - 2].close) / ihsgData.data[ihsgData.data.length - 2].close * 100).toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
            {ihsgData && (
              <div className="h-32">
                <Chart
                  options={{
                    chart: { type: 'area', sparkline: { enabled: true }, animations: { enabled: false } },
                    stroke: { curve: 'smooth', width: 2 },
                    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.45, opacityTo: 0.05 } },
                    colors: ['#3b82f6'],
                    tooltip: { theme: 'dark' }
                  } as any}
                  series={[{ name: 'IHSG', data: ihsgData.data.map((d: any) => d.close) }]}
                  type="area"
                  height="100%"
                />
              </div>
            )}
          </Card>

          <Card title="Market Sentiment">
            <div className="flex flex-col items-center justify-center h-full py-4">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-zinc-800" />
                  <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" strokeDasharray={364.4} strokeDashoffset={364.4 - (364.4 * (ihsgData ? 65 : 0) / 100)} className="text-blue-500 transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold">65</span>
                  <span className="text-[10px] text-zinc-500 uppercase">Greed</span>
                </div>
              </div>
              <p className="text-xs text-zinc-500 mt-4 text-center">Market is currently in a bullish phase with moderate buying pressure.</p>
            </div>
          </Card>
        </div>

        {/* Analysis Section */}
        {loading && !stockData && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="animate-spin text-blue-500 mb-4" size={48} />
            <p className="text-zinc-400">Analyzing market data for {symbol}...</p>
          </div>
        )}

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 p-4 rounded-xl flex items-center gap-3 mb-8">
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {stockData && analysis && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Left Column: Stats & Score */}
            <div className="lg:col-span-1 space-y-6">
              <Card>
                <div className="flex flex-col items-center text-center">
                  <h1 className="text-4xl font-black tracking-tighter mb-1">{stockData.symbol}</h1>
                  <p className="text-zinc-500 text-sm mb-6">Real-time Analysis</p>
                  
                  <div className="w-full h-1 bg-zinc-800 rounded-full mb-8 overflow-hidden">
                    <div className={cn("h-full transition-all duration-1000", analysis.score > 60 ? "bg-emerald-500" : analysis.score < 40 ? "bg-rose-500" : "bg-blue-500")} style={{ width: `${analysis.score}%` }} />
                  </div>

                  <div className="grid grid-cols-2 gap-8 w-full">
                    <Stat label="Price" value={analysis.lastPrice.toLocaleString('id-ID')} trend={analysis.change >= 0 ? 'up' : 'down'} subValue={`${analysis.changePercent.toFixed(2)}%`} />
                    <Stat label="AI Score" value={analysis.score} />
                  </div>

                  <div className={cn("mt-8 w-full py-3 rounded-xl font-bold text-sm tracking-widest", 
                    analysis.signal.includes("BUY") ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : 
                    analysis.signal.includes("SELL") ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : 
                    "bg-zinc-800 text-zinc-400")}>
                    {analysis.signal}
                  </div>
                </div>
              </Card>

              <Card title="Trading Recommendations">
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 uppercase">Support</span>
                    <span className="font-mono text-sm text-emerald-400">{analysis.tradingPlan.support.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 uppercase">Resistance</span>
                    <span className="font-mono text-sm text-rose-400">{analysis.tradingPlan.resistance.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="h-px bg-zinc-800 my-2" />
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 uppercase">Entry Price</span>
                    <span className="font-mono text-sm text-blue-400">{analysis.tradingPlan.entry.toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 uppercase">Stop Loss</span>
                    <span className="font-mono text-sm text-rose-500">{Math.floor(analysis.tradingPlan.stopLoss).toLocaleString('id-ID')}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-zinc-500 uppercase">Take Profit</span>
                    <span className="font-mono text-sm text-emerald-500">{Math.floor(analysis.tradingPlan.takeProfit).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              </Card>

              <Card title="Comprehensive Insights">
                <ul className="space-y-3">
                  {analysis.insights.map((insight, i) => (
                    <li key={i} className="flex gap-2 text-xs text-zinc-400 leading-relaxed">
                      <div className="w-1 h-1 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                      {insight}
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Disclaimer">
                <div className="flex gap-3 text-[10px] text-zinc-600 leading-relaxed italic">
                  <AlertCircle size={14} className="shrink-0" />
                  <p>
                    <strong>MANDATORY DISCLAIMER:</strong> Investasi saham memiliki risiko tinggi. Seluruh analisa dan rekomendasi di atas bersifat informatif dan bukan merupakan perintah jual atau beli. Keputusan investasi sepenuhnya berada di tangan investor. IDX Analyzer tidak bertanggung jawab atas kerugian yang mungkin timbul. <strong>DYOR (Do Your Own Research).</strong>
                  </p>
                </div>
              </Card>
            </div>

            {/* Right Column: Charts */}
            <div className="lg:col-span-3">
              {renderCharts()}
            </div>
          </div>
        )}

        {!stockData && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mb-6 border border-zinc-800">
              <BarChart3 className="text-zinc-700" size={40} />
            </div>
            <h2 className="text-2xl font-bold text-zinc-300 mb-2">Start Your Analysis</h2>
            <p className="text-zinc-500 max-w-sm">Enter a stock symbol above to get real-time technical analysis, AI scoring, and advanced charts.</p>
          </div>
        )}
      </main>

      <footer className="border-t border-zinc-800 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50">
            <Activity size={16} />
            <span className="font-bold text-sm tracking-tight">IDX Analyzer v1.0</span>
          </div>
          <div className="flex gap-8 text-sm text-zinc-500">
            <a href="#" className="hover:text-zinc-300 transition-colors">Market Data</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Privacy Policy</a>
            <a href="#" className="hover:text-zinc-300 transition-colors">Terms of Service</a>
          </div>
          <p className="text-xs text-zinc-600">© 2026 IDX Analyzer. Data provided by Yahoo Finance.</p>
        </div>
      </footer>
    </div>
  );
}
