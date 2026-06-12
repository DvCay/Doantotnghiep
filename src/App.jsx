/* global __app_id, __firebase_config, __initial_auth_token */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import * as XLSX from 'xlsx-js-style';

// === 1. IMPORTS TỪ FIREBASE ===
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  arrayUnion,
  Timestamp,
  onSnapshot
} from "firebase/firestore";

// Đăng ký các thành phần ChartJS
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler
);

// === 2. KHỞI TẠO FIREBASE ===
const appId = 'web-monitor';
const firebaseConfig = {
  apiKey: "AIzaSyCWTsHAgfhBJVDE-tOAjnjelPtiKKZFRhM",
  authDomain: "du-lieu-cb.firebaseapp.com",
  projectId: "du-lieu-cb",
  storageBucket: "du-lieu-cb.firebasestorage.app",
  messagingSenderId: "220982451942",
  appId: "1:220982451942:web:205206e24c8c1bcf202527"
};

let app, db, auth;
// Luôn khởi tạo vì đã có config thật
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  console.log("✅ Đã khởi tạo Firebase thành công.");
} catch (error) {
  console.error("❌ Lỗi khởi tạo Firebase:", error);
}

// Biến cờ để các hàm khác biết Firebase đã sẵn sàng
const isCanvasEnvironment = true;

// === 3. DỮ LIỆU BIỂU ĐỒ VÀ CẤU HÌNH ===

// (🎨 ĐÃ SỬA: Đây là hàm trợ giúp để tạo biểu đồ ban đầu)
const createInitialChartData = (type) => {
  // For live 'bpm' we render an EKG-style waveform (amplitude values).
  // For historical BPM we still keep numeric values (createHistoricalChart handles that).
  let config;
  if (type === 'bpm') {
    // Chỉ 1 dataset: PPG waveform (amplitude)
    const ppgDataset = {
      label: 'Sóng mạch (PPG)',
      data: Array(280).fill(0.5), // 280 điểm = ~6-8 đỉnh sóng
      borderColor: 'rgba(255, 77, 109, 0.95)',
      backgroundColor: 'rgba(255, 77, 109, 0.08)',
      tension: 0.4, // Smooth curve for PPG
      pointRadius: 0,
      borderWidth: 2.5,
      fill: true
    };

    return {
      labels: Array(280).fill(''),
      datasets: [ppgDataset]
    };
  } else if (type === 'spo2') {
    config = {
      label: 'Nồng độ Oxy (SpO₂)',
      data: Array(280).fill(null), // Bắt đầu trống
      borderColor: 'rgba(0, 180, 216, 0.9)',
      backgroundColor: (context) => {
        // Gradient fill dựa trên giá trị
        const chart = context.chart;
        const {ctx, chartArea} = chart;
        if (!chartArea) return 'rgba(0, 180, 216, 0.1)';
        
        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        gradient.addColorStop(0, 'rgba(220, 53, 69, 0.15)');    // Red at bottom (<90%)
        gradient.addColorStop(0.33, 'rgba(255, 193, 7, 0.15)'); // Yellow (90-95%)
        gradient.addColorStop(0.66, 'rgba(0, 180, 216, 0.15)'); // Blue (95-100%)
        gradient.addColorStop(1, 'rgba(40, 167, 69, 0.15)');    // Green at top (>95%)
        return gradient;
      },
      tension: 0.5, // Smooth curve
      pointRadius: 0,
      borderWidth: 2.5,
      fill: true,
      segment: {
        // Dynamic color based on value
        borderColor: (ctx) => {
          const value = ctx.p1.parsed.y;
          if (value >= 95) return 'rgba(40, 167, 69, 0.9)';   // Green
          if (value >= 90) return 'rgba(255, 193, 7, 0.9)';   // Yellow
          return 'rgba(220, 53, 69, 0.9)';                     // Red
        }
      }
    };
  } else if (type === 'temp') {
    config = {
      label: 'Nhiệt độ (°C)',
      data: Array(280).fill(null), // Bắt đầu trống
      borderColor: 'rgba(255, 159, 28, 0.9)',
      backgroundColor: (context) => {
        // Gradient fill dựa trên ngưỡng nhiệt độ
        const chart = context.chart;
        const {ctx, chartArea} = chart;
        if (!chartArea) return 'rgba(255, 159, 28, 0.1)';
        
        const gradient = ctx.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
        gradient.addColorStop(0, 'rgba(0, 180, 216, 0.15)');    // Blue at bottom (<35°C Hypothermia)
        gradient.addColorStop(0.4, 'rgba(40, 167, 69, 0.15)');  // Green (35-37°C Normal)
        gradient.addColorStop(0.6, 'rgba(255, 193, 7, 0.2)');   // Yellow (>37°C Fever)
        gradient.addColorStop(1, 'rgba(220, 53, 69, 0.25)');    // Red at top (High Fever)
        return gradient;
      },
      tension: 0.5, // Very smooth curve (temperature changes slowly)
      pointRadius: 0,
      borderWidth: 2.5,
      fill: true,
      segment: {
        // Dynamic color based on temperature zones
        borderColor: (ctx) => {
          const value = ctx.p1.parsed.y;
          if (value < 35) return 'rgba(0, 180, 216, 0.9)';     // Blue: Hypothermia
          if (value <= 37) return 'rgba(40, 167, 69, 0.9)';    // Green: Normal
          return 'rgba(220, 53, 69, 0.9)';                      // Red: High temperature
        }
      }
    };
  } else {
    config = {
      label: 'Dữ liệu',
      data: Array(280).fill(null),
      borderColor: 'rgba(100,100,100,0.8)',
      backgroundColor: 'rgba(100,100,100,0.05)',
      tension: 0.2,
      pointRadius: 0,
      borderWidth: 2
    };
  }

  return {
    labels: Array(280).fill(''),
    datasets: [{
      ...config,
      fill: true
    }]
  };
};

// (🎨 ĐÃ SỬA: Hàm tạo Options động dựa trên biểu đồ đang hoạt động)
const createChartOptions = (isLoading, viewMode, activeChart) => {
  // Default
  let title = 'Sóng nhịp tim (Live)';
  let yOptions = {};

  // For BPM: live -> EKG amplitude scale; historical -> BPM numeric scale
  if (activeChart === 'bpm') {
    if (viewMode === 'live') {
      // Hiển thị BPM số trong title thay vì trục Y
      title = 'Sóng mạch (PPG) (Live)';
      // Chỉ 1 trục Y duy nhất, ẩn hoàn toàn thước đo
      yOptions = {
        min: 0,
        max: 2.5,
        display: false, // Ẩn hoàn toàn trục Y
      };
    } else {
      title = 'Lịch sử Nhịp tim (BPM)';
      // Show human BPM range for historical view (single numeric axis)
      yOptions = { min: 40, max: 160, ticks: { color: '#4a5568', stepSize: 10 }, title: { display: true, text: 'Nhịp tim (BPM)' } };
    }
  } else if (activeChart === 'spo2') {
    title = viewMode === 'live' ? 'Nồng độ Oxy (Live)' : 'Lịch sử SpO₂ (%)';
    yOptions = viewMode === 'live' 
      ? { 
          min: 85, 
          max: 101, 
          ticks: { 
            color: '#4a5568',
            // Color zones
            callback: function(value) {
              if (value >= 95) return value + '%';
              if (value >= 90) return value + '%';
              return value + '%';
            }
          }, 
          title: { display: true, text: 'SpO₂ (%)' },
          grid: {
            color: (context) => {
              const value = context.tick.value;
              if (value === 95) return 'rgba(40, 167, 69, 0.3)'; // Green zone border
              if (value === 90) return 'rgba(255, 193, 7, 0.4)'; // Yellow zone border
              return 'rgba(0, 0, 0, 0.05)';
            },
            lineWidth: (context) => {
              const value = context.tick.value;
              return (value === 95 || value === 90) ? 2 : 1;
            }
          }
        } 
      : { ticks: { color: '#4a5568' }, title: { display: true, text: 'SpO₂ (%)' } };
  } else if (activeChart === 'temp') {
    title = viewMode === 'live' ? 'Nhiệt độ (Live)' : 'Lịch sử Nhiệt độ (°C)';
    yOptions = viewMode === 'live' 
      ? { 
          min: 20, 
          max: 42, 
          ticks: { 
            color: '#4a5568',
            stepSize: 2,
            // Color zones
            callback: function(value) {
              if (value === 35) return value + '°C (Hạ nhiệt)';
              if (value === 37) return value + '°C (Bình thường)';
              return value + '°C';
            }
          }, 
          title: { display: false },
          grid: {
            color: (context) => {
              const value = context.tick.value;
              if (value === 37) return 'rgba(40, 167, 69, 0.4)'; // Green: Normal upper threshold
              if (value === 35) return 'rgba(0, 180, 216, 0.4)';   // Blue: Hypothermia
              return 'rgba(0, 0, 0, 0.05)';
            },
            lineWidth: (context) => {
              const value = context.tick.value;
              return (value === 35 || value === 37) ? 2 : 1;
            }
          }
        } 
      : { ticks: { color: '#4a5568' }, title: { display: true, text: 'Nhiệt độ (°C)' } };
  }

  if (isLoading) title = 'Đang tải dữ liệu lịch sử...';

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: {
      legend: { position: 'top', labels: { color: '#4a5568' } },
      title: { display: true, text: title, color: '#1a202c', font: { size: 16 } },
      // Thêm zone labels cho SpO2 và Temperature
      ...((activeChart === 'spo2' || activeChart === 'temp') && viewMode === 'live' ? {
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.parsed.y;
              if (activeChart === 'spo2') {
                let zone = '';
                if (value >= 95) zone = ' - Tốt';
                else if (value >= 90) zone = ' - Cần theo dõi';
                else zone = ' - Nguy hiểm';
                return `SpO₂: ${value.toFixed(1)}%${zone}`;
              } else if (activeChart === 'temp') {
                let zone = '';
                if (value < 35) zone = ' - Hạ nhiệt';
                else if (value <= 37) zone = ' - Bình thường';
                else zone = ' - Nhiệt độ cao';
                return `Nhiệt độ: ${value.toFixed(1)}°C${zone}`;
              }
            }
          }
        }
      } : {})
    },
    scales: {
      x: { 
        grid: { color: 'rgba(0, 0, 0, 0.05)' }, 
        ticks: { display: false }, 
        title: { display: true, text: 'Thời gian', color: '#718096', font: { size: 11 } } 
      },
      y: { 
        grid: { color: 'rgba(0, 0, 0, 0.05)' }, 
        ...yOptions 
      }
    }
  };
};


// === 4. COMPONENT CSS (GlobalStyles) ===
const GlobalStyles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
    :root {
      --bg-gradient: linear-gradient(135deg, #f0f4f8 0%, #e5eef5 100%);
      --card-bg-color: rgba(255, 255, 255, 0.8);
      --card-border-color: rgba(255, 255, 255, 0.9);
      --card-shadow-color: rgba(100, 108, 120, 0.15);
      --hover-shadow: 0 8px 25px rgba(0,0,0,0.1);
      --text-color: #1a202c;
      --text-color-light: #4a5568;
      --text-color-lighter: #718096;
      --color-normal: #28a745;
      --color-normal-bg: rgba(40, 169, 69, 0.1);
      --color-warning: #ffc107;
      --color-warning-bg: rgba(255, 193, 7, 0.1);
      --color-danger: #dc3545;
      --color-danger-bg: rgba(220, 53, 69, 0.15);
      --color-bpm: #ff4d6d;
      --color-spo2: #00b4d8;
      --color-temp: #ff9f1c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg-gradient);
      color: var(--text-color);
      min-height: 100vh;
      padding: 2rem;
      overflow-x: hidden;
      position: relative;
      display: block;
      place-items: normal;
    }
    #root { width: 100%; }
    .ekg-background-line {
      position: fixed; top: 50%; left: 0; width: 100%; height: 300px;
      transform: translateY(-50%);
      /* Simple smooth wave SVG for background */
      background-image: url("data:image/svg+xml,%3Csvg width='200' height='300' viewBox='0 0 200 300' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 150 Q50 50 100 150 T200 150' fill='none' stroke='rgba(220, 220, 230, 0.5)' stroke-width='2'/%3E%3C/svg%3E");
      background-repeat: repeat-x;
      background-position: 0 0;
      z-index: 0;
      opacity: 0.7;
      animation: slidePPG 5s linear infinite;
    }
    @keyframes slidePPG {
      from { background-position-x: 0; }
      to { background-position-x: -200px; }
    }
    .glass-card {
      background-color: var(--card-bg-color);
      border: 1px solid var(--card-border-color);
      border-radius: 20px;
      box-shadow: 0 5px 15px var(--card-shadow-color);
      padding: 1.5rem;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .glass-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 10px 25px var(--card-shadow-color);
    }
    .metric-card.active-chart {
      transform: translateY(-5px);
      box-shadow: 0 10px 25px var(--card-shadow-color), 0 0 0 3px var(--color-bpm);
      border-color: var(--color-bpm);
    }
    .metric-card:nth-of-type(2).active-chart {
      box-shadow: 0 10px 25px var(--card-shadow-color), 0 0 0 3px var(--color-spo2);
      border-color: var(--color-spo2);
    }
    .metric-card:nth-of-type(3).active-chart {
      box-shadow: 0 10px 25px var(--card-shadow-color), 0 0 0 3px var(--color-temp);
      border-color: var(--color-temp);
    }
    .dashboard-layout { position: relative; z-index: 1; width: 100%; }
    .dashboard-container {
      width: 100%;
      max-width: 1400px;
      margin-left: auto;
      margin-right: auto;
      display: grid;
      grid-template-columns: 1fr;
      gap: 2rem;
      animation: fadeIn 0.8s ease-in-out;
    }
    @media (min-width: 1024px) {
      .dashboard-container { grid-template-columns: 2.5fr 1fr; }
    }
    .main-content { display: flex; flex-direction: column; gap: 2rem; }
    .sidebar { display: flex; flex-direction: column; gap: 2rem; }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .main-header-overview {
      display: flex; 
      flex-direction: column; 
      gap: 2rem; 
      padding: 1.5rem;
      background: linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(240,240,245,0.8) 100%);
      border-radius: 20px;
      margin-bottom: 2rem;
      border: 1px solid rgba(255,255,255,0.9);
    }
    @media (min-width: 768px) {
      .main-header-overview {
        flex-direction: row; 
        justify-content: space-between; 
        align-items: center; 
        text-align: left;
      }
    }
    /* New Header Layout Styles */
    .header-flex-container {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      width: 100%;
      gap: 3rem;
      padding-left: 2rem;
    }

    .header-content {
      flex: 1;
      max-width: 1000px;
    }

    .heart-rate-container {
      flex-shrink: 0;
      margin-left: auto;
      padding-right: 3rem;
    }

    /* Combined Header Styles */
    .combined-header {
      width: 100%;
    }

    .school-info {
      display: flex;
      align-items: center;
      gap: 2.5rem;
      padding: 2rem 3rem;
      border-radius: 20px;
      background: rgba(255,255,255,0.9);
      box-shadow: 0 4px 8px rgba(0,0,0,0.08);
      width: 100%;
      justify-content: flex-start;
      transition: all 0.3s ease;
    }

    .school-info:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(0,0,0,0.12);
      background: rgba(255,255,255,0.95);
    }

    .school-logo {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      object-fit: contain;
      background: white;
      padding: 12px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      transition: transform 0.3s ease;
    }

    .header-titles {
      flex: 1;
    }

    .school-logo:hover {
      transform: scale(1.05);
    }

    .school-name {
      font-size: 1.8rem;
      font-weight: 600;
      color: var(--text-color);
      text-align: left;
      line-height: 1.3;
      letter-spacing: -0.5px;
    }

    /* App Title Container */
    .app-title-container {
      text-align: center;
      padding: 1rem;
      width: 100%;
    }

    /* (🎨 ĐÃ THÊM: Kiểu cho logo/tên trường) */
    .school-info {
      display: flex;
      align-items: center;
      gap: 1rem; /* Khoảng cách logo và chữ */
      margin-bottom: 0.5rem; /* Khoảng cách với tiêu đề app */
    }
    .school-logo {
      width: 70px; 
      height: 70px;
      border-radius: 50%;
      object-fit: cover;
      background: white;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 5px;
    }
    .school-name {
      font-size: 1.3rem; 
      font-weight: 600;
      color: var(--text-color-light);
    }
    /* Thẻ profile sinh viên (1 người) — layout dọc, cân giữa */
    .student-info {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
      padding: 1.5rem 1rem 1rem;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 16px;
      margin-bottom: 0;
      border: 1px solid rgba(255,255,255,0.6);
      position: relative;
      overflow: hidden;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .student-info::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(circle at top, rgba(255, 77, 109, 0.06) 0%, transparent 60%);
      pointer-events: none;
    }
    .student-info:hover {
      background: rgba(255, 255, 255, 0.7);
      box-shadow: 0 6px 20px rgba(0,0,0,0.06);
    }
    /* Vòng gradient ngoài avatar */
    .student-avatar-wrap {
      padding: 4px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--color-bpm) 0%, var(--color-spo2) 100%);
      box-shadow: 0 6px 18px rgba(255, 77, 109, 0.25);
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .student-avatar-wrap:hover {
      transform: scale(1.05);
      box-shadow: 0 8px 22px rgba(255, 77, 109, 0.35);
    }
    .student-avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      object-fit: cover;
      display: block;
      border: 3px solid #ffffff;
      background: #ffffff;
    }
    .student-details {
      text-align: center;
      width: 100%;
    }
    .student-details h4 {
      font-size: 1.2rem;
      font-weight: 700;
      margin: 0 0 6px 0;
      color: var(--text-color);
      letter-spacing: -0.2px;
    }
    .student-details .student-id {
      font-size: 0.85rem;
      color: var(--text-color-lighter);
      display: inline-block;
      letter-spacing: 0.5px;
      padding: 2px 10px;
      border-radius: 999px;
      background: rgba(0, 0, 0, 0.04);
      margin-bottom: 8px;
    }
    .student-details .student-school {
      font-size: 0.85rem;
      color: var(--text-color-light);
      font-weight: 500;
      display: block;
      margin-top: 4px;
    }

    .overview-subtitle {
      font-size: 1rem;
      font-weight: 500;
      color: var(--text-color-light);
      letter-spacing: 1px;
      text-transform: uppercase;
      margin: 0.5rem 0;
      opacity: 0.8;
    }
    
    .overview-title {
      font-size: 2.4rem;
      font-weight: 700;
      color: var(--text-color);
      line-height: 1.2;
      margin: 0.5rem 0;
      background: linear-gradient(135deg, var(--text-color) 0%, #2d3748 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-shadow: 0 2px 4px rgba(0,0,0,0.05);
      letter-spacing: -0.5px;
    }
    .heart-rate-container {
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 1rem;
    }

    .heart-rate-circle {
      width: 130px;
      height: 130px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(255,255,255,0.9) 0%, rgba(255, 77, 109, 0.1) 70%);
      display: flex;
      justify-content: center;
      align-items: center;
      box-shadow: 0 0 0 12px rgba(255, 77, 109, 0.15);
      animation: pulseHeart 1s cubic-bezier(0.4, 0, 0.6, 1) infinite;
      position: relative;
      margin-right: 2rem;
    }

    .heart-rate-inner-circle {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      background: var(--color-bpm);
      display: flex;
      justify-content: center;
      align-items: center;
      transition: all 0.3s ease;
      box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
    }

    .heart-rate-inner-circle svg { 
      width: 65px;
      height: 65px;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.1));
      color: white;
      animation: beatHeart 1s ease-in-out infinite;
    }

    @keyframes pulseHeart {
      0%, 100% { 
        transform: scale(1);
        box-shadow: 0 0 0 12px rgba(255, 77, 109, 0.15);
      }
      50% { 
        transform: scale(1.05);
        box-shadow: 0 0 0 15px rgba(255, 77, 109, 0);
      }
    }

    @keyframes beatHeart {
      0%, 100% { 
        transform: scale(1);
      }
      50% { 
        transform: scale(0.9);
      }
    }
    .metrics-grid { display: grid; grid-template-columns: 1fr; gap: 1.5rem; }
    @media (min-width: 768px) {
      .metrics-grid { grid-template-columns: repeat(3, 1fr); }
    }
    .metric-card {
      display: flex; 
      flex-direction: column; 
      justify-content: space-between; 
      min-height: 220px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
      transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid rgba(255,255,255,0.7);
    }
    .metric-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 4px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent);
      transform: translateX(-100%);
      transition: transform 0.5s ease;
    }
    .metric-card:hover::before {
      transform: translateX(100%);
    }
    .card-header {
      display: flex; 
      justify-content: space-between; 
      align-items: flex-start; 
      margin-bottom: 1rem;
      padding: 1rem 1.5rem;
      background: rgba(255,255,255,0.1);
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .header-text { 
      flex-grow: 1; 
    }
    .card-header h2 {
      font-size: 1.2rem; 
      font-weight: 600; 
      color: var(--text-color); 
      margin-bottom: 0.25rem;
      letter-spacing: 0.5px;
    }
    .card-header .sensor-name {
      font-size: 0.85rem; color: var(--text-color-lighter); display: block;
    }
    .metric-icon {
      flex-shrink: 0; width: 48px; height: 48px;
      display: flex; justify-content: center; align-items: center;
      border-radius: 50%;
    }
    .metric-card.status-normal .metric-icon { color: var(--color-normal); background-color: var(--color-normal-bg); }
    .metric-card.status-warning .metric-icon { color: var(--color-warning); background-color: var(--color-warning-bg); }
    .metric-card.status-danger .metric-icon { color: var(--color-danger); background-color: var(--color-danger-bg); }
    .metric-card:nth-of-type(1) .metric-icon { color: var(--color-bpm); background-color: rgba(255, 77, 109, 0.1); }
    .metric-card:nth-of-type(2) .metric-icon { color: var(--color-spo2); background-color: rgba(0, 180, 216, 0.1); }
    .metric-card:nth-of-type(3) .metric-icon { color: var(--color-temp); background-color: rgba(255, 159, 28, 0.1); }
    .card-body {
      flex-grow: 1; display: flex; justify-content: flex-start; align-items: baseline; margin-bottom: 1rem;
    }
    .metric-value {
      font-size: 3.5rem; font-weight: 700; color: var(--text-color); line-height: 1;
    }
    .unit {
      font-size: 1.5rem; font-weight: 500; color: var(--text-color-light); margin-left: 0.5rem;
    }
    .card-footer { text-align: left; margin-top: auto; }
    .status-indicator {
      padding: 0.4rem 1rem; border-radius: 25px; font-weight: 600; font-size: 0.9rem; display: inline-block;
    }
    .status-normal .status-indicator { background-color: var(--color-normal-bg); color: var(--color-normal); }
    .status-normal .metric-value { color: var(--color-normal); }
    .status-warning .status-indicator { background-color: var(--color-warning-bg); color: var(--color-warning); }
    .status-warning .metric-value { color: var(--color-warning); }
    .status-danger .status-indicator { background-color: var(--color-danger-bg); color: var(--color-danger); animation: pulseRed 1.5s infinite; }
    .status-danger .metric-value { color: var(--color-danger); }
    @keyframes pulseRed {
      0%, 100% { background-color: rgba(220, 53, 69, 0.15); }
      50% { background-color: rgba(220, 53, 69, 0.3); }
    }
    .chart-section { height: 400px; width: 100%; }
    .widget-title {
      font-size: 1.2rem; font-weight: 600; color: var(--text-color); margin-bottom: 1rem;
    }
    .connection-status-card { display: flex; flex-direction: column; gap: 0.5rem; }
    .status-bubble {
      padding: 0.75rem 1rem; border-radius: 12px; font-weight: 600; font-size: 1rem;
    }
    .status-bubble.status-normal { background-color: var(--color-normal-bg); color: var(--color-normal); }
    .status-bubble.status-danger { background-color: var(--color-danger-bg); color: var(--color-danger); animation: pulseRed 1.5s infinite; }
    .calendar-widget { padding: 1rem; }
    .calendar-header {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 1rem; font-weight: 500;
    }
    .calendar-nav button {
      background: none; border: none; cursor: pointer; color: var(--text-color);
    }
    .calendar-grid {
      display: grid; grid-template-columns: repeat(7, 1fr); gap: 0.5rem; text-align: center;
    }
    .calendar-dow {
      font-size: 0.8rem; font-weight: 600; color: var(--text-color-light);
    }
    .calendar-day {
      padding: 0.5rem; font-size: 0.9rem; border-radius: 50%;
      cursor: pointer; transition: all 0.2s ease;
      border: 2px solid transparent;
    }
    .calendar-day.other-month { color: var(--text-color-lighter); opacity: 0.6; }
    .calendar-day.today:not(.selected) {
      background-color: #e0e8f0;
      color: var(--text-color);
      font-weight: 700;
    }
    .calendar-day.selected {
      background-color: var(--color-bpm);
      color: white !important;
      font-weight: 700;
      border-color: var(--color-bpm);
    }
    .calendar-day:not(.selected):not(.other-month):hover {
      background-color: rgba(0, 0, 0, 0.05);
    }
    .loading-overlay {
      position: absolute; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(255, 255, 255, 0.7);
      display: flex; justify-content: center; align-items: center;
      font-size: 1.2rem; font-weight: 600; color: var(--text-color);
      z-index: 10; border-radius: 20px;
    }
    .chart-section { position: relative; }

    /* Styles cho Alert */
    .alert-banner {
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 1rem 1.5rem;
      border-radius: 12px;
      background: rgba(220, 53, 69, 0.95);
      color: white;
      font-weight: 600;
      z-index: 1000;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3);
      animation: slideIn 0.5s ease, pulse 2s infinite;
    }
    .alert-icon {
      font-size: 1.5rem;
      animation: rotate 1s infinite;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes pulse {
      0% { box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3); }
      50% { box-shadow: 0 4px 25px rgba(220, 53, 69, 0.5); }
      100% { box-shadow: 0 4px 15px rgba(220, 53, 69, 0.3); }
    }
    @keyframes rotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    /* Styles cho Historical Data */
    .historical-data {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: var(--card-bg-color);
      padding: 2rem;
      border-radius: 20px;
      box-shadow: var(--hover-shadow);
      width: 90%;
      max-width: 600px;
      z-index: 1000;
      animation: fadeScale 0.3s ease;
    }
    .historical-data h3 {
      margin-bottom: 1rem;
      color: var(--text-color);
      font-size: 1.2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .historical-data .close-btn {
      background: none;
      border: none;
      color: var(--text-color-light);
      cursor: pointer;
      font-size: 1.5rem;
      padding: 5px;
      transition: color 0.3s ease;
    }
    .historical-data .close-btn:hover {
      color: var(--color-danger);
    }
    .readings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-top: 1rem;
    }
    .reading-item {
      background: rgba(255, 255, 255, 0.5);
      padding: 1rem;
      border-radius: 12px;
      text-align: center;
    }
    .reading-value {
      font-size: 1.8rem;
      font-weight: 700;
      color: var(--text-color);
      margin: 0.5rem 0;
    }
    .reading-time {
      font-size: 0.9rem;
      color: var(--text-color-light);
    }
    @keyframes fadeScale {
      from { 
        opacity: 0; 
        transform: translate(-50%, -50%) scale(0.95);
      }
      to { 
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }
    }
    
    /* Kiểu cho thẻ sinh viên */
    .student-info-card {
      background: linear-gradient(135deg, rgba(255,255,255,0.8) 0%, rgba(240,240,240,0.6) 100%);
      margin-bottom: 2rem; /* Tăng khoảng cách với calendar */
    }
    .student-info-card h4 {
      font-size: 1.1rem;
      color: var(--text-color);
      margin: 0 0 5px 0;
    }
    .student-info-card span {
      font-size: 0.9rem;
      color: var(--text-color-light);
      display: block;
    }
    /* Thêm hiệu ứng cho cards */
    .calendar-card {
      transition: transform 0.3s ease, box-shadow 0.3s ease;
    }
    .calendar-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    }
    /* Responsive adjustments */
    @media (max-width: 768px) {
      .student-info-card {
        order: -1; /* Đảm bảo thông tin sinh viên luôn ở trên cùng trên mobile */
      }
      .calendar-card {
        margin-top: 1rem;
      }
    }
    /* Hiệu ứng hover cho cards */
    .glass-card {
      transition: all 0.3s ease;
    }
    .glass-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 20px rgba(0,0,0,0.1);
    }

    @media (max-width: 480px) {
      body { 
        padding: 1rem; 
        background: linear-gradient(135deg, #f0f4f8 0%, #e5eef5 100%);
      }
      .dashboard-container { 
        padding: 0.5rem;
      }
      .main-header-overview { 
        text-align: center;
        padding: 1rem;
      }
      .overview-title { 
        font-size: 1.8rem;
        line-height: 1.3;
      }
      .metric-value { 
        font-size: 2.8rem; 
      }
      .chart-section { 
        height: 250px;
        margin: 1rem 0;
      }
      .glass-card { 
        padding: 1rem;
        margin-bottom: 1rem;
      }
      .school-info {
        justify-content: center;
        flex-direction: column;
        text-align: center;
        padding: 1rem;
      }
      .school-name {
        font-size: 1.1rem;
        margin-top: 0.5rem;
      }
      .student-info {
        flex-direction: column;
        text-align: center;
        padding: 1.5rem;
      }
      .student-details {
        margin-top: 1rem;
        padding-left: 0;
      }
      .student-avatar {
        width: 80px;
        height: 80px;
        margin: 0;
      }
    }

    /* Save Status Indicator */
    .save-status-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 500;
      transition: all 0.3s ease;
    }
    .save-status-indicator.waiting {
      background: rgba(113, 128, 150, 0.1);
      color: #718096;
    }
    .save-status-indicator.saving {
      background: rgba(0, 180, 216, 0.15);
      color: #00b4d8;
      animation: pulse 1.5s ease-in-out infinite;
    }
    .save-status-indicator.saved {
      background: rgba(40, 167, 69, 0.15);
      color: #28a745;
    }
    .save-status-indicator.error {
      background: rgba(220, 53, 69, 0.15);
      color: #dc3545;
    }
    .save-icon {
      font-size: 1.1rem;
      display: inline-flex;
      align-items: center;
    }
    .save-icon.saving {
      animation: rotate 1s linear infinite;
    }
    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .save-details {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .save-time {
      font-size: 0.75rem;
      opacity: 0.8;
    }
    
    /* Measuring indicator pulse */
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    /* Responsive styles */
    @media (max-width: 1024px) {
      .header-flex-container {
        flex-direction: column;
        align-items: flex-start;
        gap: 1.5rem;
      }

      .heart-rate-container {
        align-self: flex-end;
        padding-right: 1rem;
      }
    }

    @media (max-width: 768px) {
      .header-flex-container {
        flex-direction: column;
        align-items: center;
      }

      .header-content {
        width: 100%;
        text-align: center;
      }

      .heart-rate-container {
        align-self: center;
        padding-right: 0;
        margin-top: 1rem;
      }

      .school-info {
        flex-direction: column;
        padding: 1.5rem;
        align-items: center;
      }

      .school-logo {
        width: 80px;
        height: 80px;
        margin-bottom: 1rem;
      }

      .school-name {
        font-size: 1.3rem;
        text-align: center;
      }

      .overview-title {
        font-size: 2rem;
        padding: 0 1rem;
      }

      .app-title-container {
        text-align: center;
      }
    }

    /* === Empty state cho metric card (chưa có tín hiệu) === */
    .metric-empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.4rem;
      padding-top: 0.5rem;
      animation: fadeIn 0.3s ease;
    }
    .metric-empty__icon {
      font-size: 2.2rem;
      line-height: 1;
      animation: bobUpDown 1.6s ease-in-out infinite;
    }
    .metric-empty__text {
      font-size: 0.95rem;
      font-weight: 500;
      color: var(--text-color-light);
      line-height: 1.3;
    }
    .metric-value--loading {
      color: var(--text-color-lighter);
      letter-spacing: 0.1em;
      animation: pulseLoading 1.2s ease-in-out infinite;
    }
    @keyframes bobUpDown {
      0%, 100% { transform: translateY(0); }
      50%      { transform: translateY(-6px); }
    }
    @keyframes pulseLoading {
      0%, 100% { opacity: 0.4; }
      50%      { opacity: 1; }
    }

    /* === Toast (thay alert browser) === */
    .toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      min-width: 280px;
      max-width: 90vw;
      padding: 0.85rem 1rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.96);
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
      border-left: 4px solid var(--text-color-light);
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 500;
      color: var(--text-color);
      z-index: 9999;
      animation: toastSlideIn 0.25s cubic-bezier(0.2, 0.9, 0.3, 1.2);
    }
    .toast--info    { border-left-color: var(--color-spo2); }
    .toast--success { border-left-color: var(--color-normal); }
    .toast--warning { border-left-color: var(--color-warning); }
    .toast--error   { border-left-color: var(--color-danger); }
    .toast__icon { font-size: 1.3rem; flex-shrink: 0; }
    .toast__msg  { flex: 1; line-height: 1.4; font-size: 0.95rem; }
    .toast__close {
      background: none;
      border: none;
      font-size: 1.4rem;
      line-height: 1;
      color: var(--text-color-lighter);
      cursor: pointer;
      padding: 0 4px;
      border-radius: 6px;
      transition: all 0.2s ease;
    }
    .toast__close:hover { color: var(--text-color); background: rgba(0,0,0,0.06); }
    @keyframes toastSlideIn {
      from { opacity: 0; transform: translate(-50%, -20px); }
      to   { opacity: 1; transform: translate(-50%, 0); }
    }
    @media (max-width: 480px) {
      .toast { top: 12px; min-width: auto; width: calc(100% - 24px); }
    }

    /* === UI polish overrides: dashboard y te gon va chuyen nghiep hon === */
    :root {
      --bg-gradient: linear-gradient(180deg, #f6f9fc 0%, #edf3f8 100%);
      --card-bg-color: rgba(255, 255, 255, 0.94);
      --card-border-color: #dfe8f1;
      --card-shadow-color: rgba(17, 24, 39, 0.08);
      --hover-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
      --text-color: #172033;
      --text-color-light: #475569;
      --text-color-lighter: #7b8aa0;
      --color-normal: #16a34a;
      --color-normal-bg: #dcfce7;
      --color-warning: #d97706;
      --color-warning-bg: #fef3c7;
      --color-danger: #e11d48;
      --color-danger-bg: #ffe4e6;
      --color-bpm: #f43f5e;
      --color-spo2: #0284c7;
      --color-temp: #f59e0b;
    }

    body {
      padding: 1.25rem;
      background:
        linear-gradient(90deg, rgba(2,132,199,0.04) 1px, transparent 1px),
        linear-gradient(180deg, rgba(2,132,199,0.04) 1px, transparent 1px),
        var(--bg-gradient);
      background-size: 32px 32px, 32px 32px, auto;
    }

    .ekg-background-line {
      display: none;
    }

    .dashboard-container {
      max-width: 1520px;
      gap: 1.25rem;
      align-items: start;
    }

    @media (min-width: 1180px) {
      .dashboard-container {
        grid-template-columns: minmax(0, 1fr) 340px;
      }
    }

    .main-content,
    .sidebar {
      gap: 1.25rem;
    }

    .glass-card {
      border-radius: 16px;
      border: 1px solid var(--card-border-color);
      background: var(--card-bg-color);
      box-shadow: 0 10px 30px rgba(15, 23, 42, 0.07);
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
    }

    .glass-card:hover,
    .calendar-card:hover,
    .student-info-card:hover {
      transform: none;
      box-shadow: 0 14px 38px rgba(15, 23, 42, 0.1);
    }

    .main-header-overview {
      margin-bottom: 0;
      padding: 1.25rem;
      border-radius: 18px;
      background:
        linear-gradient(135deg, rgba(255,255,255,0.98) 0%, rgba(245,249,252,0.96) 58%, rgba(232,244,250,0.9) 100%);
      border: 1px solid #dbe7f0;
      box-shadow: 0 18px 44px rgba(15, 23, 42, 0.09);
    }

    .header-flex-container {
      gap: 1.25rem;
      padding-left: 0;
      align-items: stretch;
    }

    .header-content {
      display: grid;
      grid-template-columns: minmax(240px, 0.56fr) minmax(620px, 1.44fr);
      align-items: center;
      gap: 1.25rem;
      max-width: none;
    }

    .school-info {
      min-height: 112px;
      margin: 0;
      padding: 1rem 1.15rem;
      border-radius: 14px;
      background: #ffffff;
      border: 1px solid #e3ecf4;
      box-shadow: 0 8px 22px rgba(15, 23, 42, 0.07);
    }

    .school-info:hover,
    .school-logo:hover {
      transform: none;
    }

    .school-logo {
      width: 64px;
      height: 64px;
      padding: 6px;
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
    }

    .school-name {
      color: #334155;
      font-size: 1.05rem;
      line-height: 1.35;
      letter-spacing: 0;
    }

    .app-title-container {
      text-align: left;
      padding: 0.25rem 0;
    }

    .overview-subtitle {
      margin: 0 0 0.35rem;
      color: #64748b;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.08em;
    }

    .overview-title {
      margin: 0 0 0.9rem;
      font-size: clamp(2rem, 2.65vw, 2.55rem);
      line-height: 1.08;
      letter-spacing: 0;
      color: #111827;
      background: none;
      -webkit-text-fill-color: currentColor;
      text-shadow: none;
      white-space: nowrap;
    }

    .patient-form {
      display: flex;
      align-items: center;
      justify-content: flex-start;
      gap: 0.8rem 1rem;
      flex-wrap: wrap;
    }

    .history-heading {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .history-export-btn,
    .history-note {
      min-height: 34px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 999px;
      padding: 0.45rem 0.85rem;
      font-size: 0.82rem;
      font-weight: 700;
      line-height: 1;
      white-space: nowrap;
    }

    .history-export-btn {
      color: #ffffff;
      background: var(--color-bpm);
      box-shadow: 0 8px 18px rgba(244, 63, 94, 0.22);
      cursor: pointer;
    }

    .history-export-btn:hover {
      background: #e11d48;
    }

    .history-note {
      color: #64748b;
      background: #eef2f7;
      border: 1px solid #dbe5ee;
    }

    .history-note--future {
      color: #0369a1;
      background: #e0f2fe;
      border-color: #bae6fd;
    }

    .heart-rate-container {
      padding: 0;
      margin-left: auto;
      padding-right: 0;
      min-width: 128px;
    }

    .heart-rate-circle {
      width: 108px;
      height: 108px;
      margin-right: 0;
      box-shadow: 0 0 0 10px rgba(244, 63, 94, 0.11), 0 14px 30px rgba(244, 63, 94, 0.12);
    }

    .heart-rate-inner-circle {
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #fb7185 0%, var(--color-bpm) 100%);
    }

    .heart-rate-inner-circle svg {
      width: 50px;
      height: 50px;
    }

    .metrics-grid {
      gap: 1rem;
    }

    .metric-card {
      min-height: 206px;
      padding: 1.1rem;
      border-radius: 16px;
      background: #ffffff;
      border: 1px solid #dfe8f1;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.07);
    }

    .metric-card::before {
      display: none;
    }

    .metric-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
    }

    .metric-card.active-chart,
    .metric-card:nth-of-type(2).active-chart,
    .metric-card:nth-of-type(3).active-chart {
      transform: none;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.12);
      border-color: currentColor;
      outline: 3px solid rgba(244, 63, 94, 0.12);
    }

    .metric-card:nth-of-type(2).active-chart {
      outline-color: rgba(2, 132, 199, 0.14);
    }

    .metric-card:nth-of-type(3).active-chart {
      outline-color: rgba(245, 158, 11, 0.16);
    }

    .card-header {
      padding: 0;
      margin-bottom: 1.2rem;
      background: transparent;
      border-bottom: 0;
      align-items: center;
    }

    .card-header h2 {
      margin: 0 0 0.2rem;
      font-size: 1.02rem;
      line-height: 1.25;
      letter-spacing: 0;
    }

    .card-header .sensor-name {
      color: #8a99ac;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.02em;
    }

    .metric-icon {
      width: 44px;
      height: 44px;
      border-radius: 14px;
    }

    .card-body {
      min-height: 76px;
      margin-bottom: 1rem;
      align-items: flex-end;
    }

    .metric-value {
      font-size: clamp(2.8rem, 4vw, 4rem);
      letter-spacing: 0;
      font-variant-numeric: tabular-nums;
    }

    .unit {
      margin-left: 0.35rem;
      margin-bottom: 0.35rem;
      font-size: 1.15rem;
      font-weight: 700;
      color: #64748b;
    }

    .card-footer {
      gap: 0.75rem;
      min-height: 36px;
    }

    .status-indicator {
      padding: 0.42rem 0.85rem;
      border-radius: 999px;
      font-size: 0.78rem;
      line-height: 1;
      white-space: nowrap;
    }

    .chart-section {
      height: clamp(340px, 42vh, 480px);
      padding: 1.25rem;
      border-radius: 16px;
    }

    .sidebar {
      position: sticky;
      top: 1rem;
    }

    .widget-title {
      margin-bottom: 0.85rem;
      color: #1f2937;
      font-size: 1rem;
      line-height: 1.25;
    }

    .connection-status-card,
    .student-info-card,
    .calendar-card {
      padding: 1.15rem;
    }

    .status-bubble {
      border-radius: 12px;
      padding: 0.85rem 0.95rem;
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .save-status-indicator {
      margin-top: 0.75rem !important;
      border-radius: 12px;
      padding: 0.75rem 0.85rem;
      align-items: flex-start;
      line-height: 1.3;
    }

    .student-info-card {
      margin-bottom: 0;
      background: #ffffff;
    }

    .student-info {
      padding: 1rem;
      border-radius: 14px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
    }

    .student-avatar-wrap {
      background: linear-gradient(135deg, #38bdf8 0%, #f43f5e 100%);
      box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
    }

    .student-avatar {
      width: 88px;
      height: 88px;
    }

    .student-details h4 {
      font-size: 1.05rem;
    }

    .student-details .student-id,
    .student-details .student-school {
      font-size: 0.8rem;
    }

    .calendar-widget {
      padding: 0;
    }

    .calendar-header {
      margin-bottom: 0.85rem;
    }

    .calendar-grid {
      gap: 0.35rem;
    }

    .calendar-day {
      display: grid;
      place-items: center;
      min-height: 34px;
      border-radius: 10px;
      border: 1px solid transparent;
    }

    .calendar-day.selected {
      background: #f43f5e;
      border-color: #f43f5e;
      box-shadow: 0 8px 18px rgba(244, 63, 94, 0.22);
    }

    .calendar-day.today:not(.selected) {
      background: #e0f2fe;
      color: #0369a1;
    }

    .toast {
      border-radius: 14px;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.18);
    }

    @media (max-width: 1180px) {
      .sidebar {
        position: static;
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .calendar-card {
        grid-column: span 2;
      }
    }

    @media (max-width: 920px) {
      body {
        padding: 0.85rem;
      }

      .header-flex-container,
      .header-content {
        display: flex;
        flex-direction: column;
        align-items: stretch;
      }

      .app-title-container {
        text-align: center;
      }

      .overview-title {
        white-space: normal;
      }

      .patient-form {
        justify-content: center;
      }

      .school-info {
        justify-content: center;
      }

      .heart-rate-container {
        align-self: center;
        margin-top: 0.25rem;
      }

      .sidebar {
        grid-template-columns: 1fr;
      }

      .calendar-card {
        grid-column: auto;
      }
    }

    @media (max-width: 640px) {
      .main-header-overview,
      .metric-card,
      .chart-section,
      .connection-status-card,
      .student-info-card,
      .calendar-card {
        border-radius: 14px;
      }

      .school-info {
        flex-direction: column;
        text-align: center;
      }

      .overview-title {
        font-size: 1.75rem;
      }

      .metrics-grid {
        grid-template-columns: 1fr;
      }

      .card-footer {
        flex-wrap: wrap;
      }

      .chart-section {
        height: 300px;
      }
    }

    /* === Tôn trọng prefers-reduced-motion === */
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
      .ekg-background-line,
      .heart-rate-circle,
      .alert-banner,
      .alert-icon,
      .metric-empty__icon,
      .metric-value--loading {
        animation: none !important;
      }
    }
  `}</style>
);

// === 5. CÁC COMPONENT CON (ICONS, CALENDAR) ===
const HeartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
  </svg>
);
const LungsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"></path>
    <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path>
    <path d="M12 2v2"></path><path d="M12 20v2"></path>
    <path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path>
    <path d="M2 12h2"></path><path d="M20 12h2"></path>
    <path d="m4.93 19.07 1.41-1.41"></path><path d="m17.66 6.34 1.41-1.41"></path>
  </svg>
);
const TempIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"></path>
  </svg>
);
const HeartRateCircle = ({ bpm = 60 }) => {
  // Allow bpm=0 to mean paused; map bpm to animation duration
  const normalizedBpm = Math.max(0, Math.min(180, Math.round(bpm)));
  const isPaused = normalizedBpm === 0;
  const secondsPerBeat = normalizedBpm > 0 ? 60 / normalizedBpm : 1;
  // Cap animation duration between 0.4s and 1s for visual appeal
  const animationDuration = `${Math.max(0.4, Math.min(1.0, secondsPerBeat))}s`;

  const circleStyle = {
    animation: `pulseHeart ${animationDuration} cubic-bezier(0.4, 0, 0.6, 1) infinite`,
    animationPlayState: isPaused ? 'paused' : 'running',
    opacity: isPaused ? 0.5 : 1
  };

  const heartStyle = {
    animation: `beatHeart ${animationDuration} ease-in-out infinite`,
    animationPlayState: isPaused ? 'paused' : 'running'
  };

  return (
    <div className="heart-rate-container">
      <div className="heart-rate-circle" style={circleStyle}>
        <div className="heart-rate-inner-circle">
          <svg
            viewBox="0 0 24 24"
            fill={isPaused ? "#CCCCCC" : "#FFFFFF"}
            style={heartStyle}
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
          </svg>
        </div>
      </div>
    </div>
  );
};

const Calendar = ({ selectedDate, onDateSelect }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date(selectedDate.getFullYear(), selectedDate.getMonth()));
  const today = new Date();
  const getDocId = (date) => {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };
  const todayStr = getDocId(today);
  const selectedStr = getDocId(selectedDate);

  const generateDays = () => {
    const days = [];
    const startDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const endDate = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const startDayOfWeek = (startDate.getDay() + 6) % 7;
    for (let i = startDayOfWeek; i > 0; i--) {
      const date = new Date(startDate);
      date.setDate(date.getDate() - i);
      days.push({ date, isOtherMonth: true });
    }
    for (let i = 1; i <= endDate.getDate(); i++) {
      const date = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i);
      days.push({ date, isCurrentMonth: true });
    }
    const endDayOfWeek = (endDate.getDay() + 6) % 7;
    for (let i = 1; i < 7 - endDayOfWeek; i++) {
      const date = new Date(endDate);
      date.setDate(date.getDate() + i);
      days.push({ date, isOtherMonth: true });
    }
    return days;
  };

  const days = generateDays();
  const dow = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  return (
    <div className="calendar-widget">
      <div className="calendar-header">
        <span>{`Today: ${today.getDate()}`}</span>
        <span>{currentMonth.toLocaleString('vi-VN', { month: 'long', year: 'numeric' })}</span>
        <div className="calendar-nav">
          <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() - 1)))}>&lt;</button>
          <button onClick={() => setCurrentMonth(new Date(currentMonth.setMonth(currentMonth.getMonth() + 1)))}>&gt;</button>
        </div>
      </div>
      <div className="calendar-grid">
        {dow.map(d => <div key={d} className="calendar-dow">{d}</div>)}
        {days.map(({ date, isOtherMonth }, index) => {
          const dateStr = getDocId(date);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedStr;

          let classes = "calendar-day";
          if (isOtherMonth) classes += " other-month";
          if (isToday) classes += " today";
          if (isSelected) classes += " selected";

          return (
            <div
              key={index}
              className={classes}
              onClick={() => !isOtherMonth && onDateSelect(date)}
            >
              {date.getDate()}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// === 6. HELPER FUNCTION: LẤY DOCUMENT ID ===
// Use local date (YYYY-MM-DD) to avoid UTC timezone shifts which can
// make `toISOString()` produce the previous/next day for local timezones.
const getDocId = (date) => {
  const d = new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// === 7. COMPONENT APP CHÍNH ===
// Alert Component
const AlertBanner = ({ message }) => (
  <div className="alert-banner">
    <span className="alert-icon">⚠️</span>
    {message}
  </div>
);

// --- Toast: thông báo nhẹ (thay thế alert() trình duyệt) ---
const showToast = (message, type = 'info', duration = 3500) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app-toast', { detail: { message, type, duration } }));
};

const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  const icon = toast.type === 'error' ? '❌'
    : toast.type === 'warning' ? '⚠️'
    : toast.type === 'success' ? '✅'
    : 'ℹ️';
  return (
    <div className={`toast toast--${toast.type || 'info'}`} role="status" aria-live="polite">
      <span className="toast__icon">{icon}</span>
      <span className="toast__msg">{toast.message}</span>
      <button className="toast__close" onClick={onClose} aria-label="Đóng">×</button>
    </div>
  );
};

// --- Hook: số đếm mượt (count-up) ---
const useCountUp = (target, duration = 500) => {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);
  const rafRef = useRef(0);
  useEffect(() => {
    if (target === valueRef.current) return;
    cancelAnimationFrame(rafRef.current);
    const from = valueRef.current;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const v = from + (target - from) * eased;
      valueRef.current = v;
      setValue(v);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
};

// Helper: Export records to CSV and trigger download
const exportToCSV = (records, filename = 'lich_su_benh_nhan.xlsx', patientNameParam = '') => {
  if (!records || records.length === 0) {
    showToast('Chưa có bản ghi sức khỏe để xuất báo cáo.', 'warning');
    return;
  }

  // Tạo workbook và worksheet
  const wb = XLSX.utils.book_new();
  
  // Đếm số lượng bệnh nhân unique
  const uniquePatients = new Set(records.map(r => r.patientName || 'Không có tên'));
  const patientCount = uniquePatients.size;
  
  // Thêm thông tin header với metadata - gộp thành 1 dòng, không có dòng trống
  const infoData = [
    ['BÁO CÁO GIÁM SÁT SỨC KHỎE'],
    ['Trung Tâm Giám Sát Sức Khỏe - Đại học Giao thông vận tải'],
    [`Ngày xuất: ${new Date().toLocaleString('vi-VN')}`],
    [`Tổng số bệnh nhân: ${patientCount} | Tổng số bản ghi: ${records.length}`],
    ['Bệnh nhân', 'Giới tính', 'Tuổi', 'Thời gian', 'Nhịp tim (BPM)', 'SpO2 (%)', 'Nhiệt độ (°C)', 'Trạng thái']
  ];

  // Function kiểm tra trạng thái và trả về text
  const getStatusText = (bpm, spo2, temp) => {
    // Chỉ kiểm tra các chỉ số có giá trị (> 0)
    const isBpmCritical = bpm > 0 && (bpm < 50 || bpm > 120);
    const isBpmWarning = bpm > 0 && ((bpm >= 50 && bpm < 60) || (bpm > 100 && bpm <= 120));
    const isSpo2Critical = spo2 > 0 && spo2 < 90;
    const isSpo2Warning = spo2 > 0 && (spo2 >= 90 && spo2 < 95);
    const isTempCritical = temp > 0 && (temp < 35 || temp > 37);
    const isTempWarning = false;

    // Kiểm tra xem có chỉ số nào được đo không
    const hasMeasurement = bpm > 0 || spo2 > 0 || temp > 0;
    
    if (!hasMeasurement) {
      return '⚪ Chưa đo';
    } else if (isBpmCritical || isSpo2Critical || isTempCritical) {
      return '🔴 Nguy hiểm';
    } else if (isBpmWarning || isSpo2Warning || isTempWarning) {
      return '🟡 Trạng thái cần theo dõi';
    } else {
      return '✅ Bình thường';
    }
  };

  // Thêm dữ liệu với cột bệnh nhân và trạng thái
  const dataRows = records.map(r => {
    const time = r.timestamp && r.timestamp.seconds
      ? new Date(r.timestamp.seconds * 1000).toLocaleString('vi-VN')
      : '';
    const patient = r.patientName || 'Không có tên';
    const gender = r.patientGender || 'N/A';
    const age = r.patientAge || 'N/A';
    // Hiển thị "-" cho các giá trị = 0 hoặc không có
    const bpmDisplay = (r.bpm && r.bpm > 0) ? r.bpm : '-';
    const spo2Display = (r.spo2 && r.spo2 > 0) ? r.spo2 : '-';
    const tempDisplay = (r.temp && r.temp > 0) ? r.temp : '-';
    const status = getStatusText(r.bpm || 0, r.spo2 || 0, r.temp || 0);
    return [patient, gender, age, time, bpmDisplay, spo2Display, tempDisplay, status];
  });

  const allData = [...infoData, ...dataRows];
  const ws = XLSX.utils.aoa_to_sheet(allData);

  // Định dạng độ rộng cột
  ws['!cols'] = [
    { wch: 20 }, // Bệnh nhân
    { wch: 12 }, // Giới tính
    { wch: 8 },  // Tuổi
    { wch: 25 }, // Thời gian
    { wch: 18 }, // BPM
    { wch: 15 }, // SpO2
    { wch: 20 }, // Nhiệt độ
    { wch: 44 }  // Trạng thái
  ];

  // Định dạng chiều cao hàng (row height)
  ws['!rows'] = [
    { hpt: 35 },  // Hàng 1: Tiêu đề cao hơn
    { hpt: 25 },  // Hàng 2: Subtitle
    { hpt: 20 },  // Hàng 3: Ngày xuất
    { hpt: 20 }   // Hàng 4: Tổng số
  ];

  // Merge cells cho title và thông tin (8 cột: A-H) - không có dòng trống
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }, // Title (hàng 1)
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }, // Subtitle (hàng 2)
    { s: { r: 2, c: 0 }, e: { r: 2, c: 7 } }, // Ngày xuất (hàng 3)
    { s: { r: 3, c: 0 }, e: { r: 3, c: 7 } }  // Tổng số bệnh nhân (hàng 4)
  ];

  // Merge cells cho cột Bệnh nhân - gộp các dòng liên tiếp cùng tên
  let currentPatient = null;
  let startRow = null;
  
  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = 5 + i; // Dữ liệu bắt đầu từ hàng 6 (index 5)
    const patient = dataRows[i][0]; // Cột Bệnh nhân
    
    if (patient !== currentPatient) {
      // Nếu có nhóm trước đó và có nhiều hơn 1 dòng, merge nó
      if (startRow !== null && startRow < rowNum - 1) {
        merges.push({ s: { r: startRow, c: 0 }, e: { r: rowNum - 1, c: 0 } });
      }
      // Bắt đầu nhóm mới
      currentPatient = patient;
      startRow = rowNum;
    }
  }
  
  // Merge nhóm cuối cùng nếu có nhiều hơn 1 dòng
  if (startRow !== null && startRow < 5 + dataRows.length - 1) {
    merges.push({ s: { r: startRow, c: 0 }, e: { r: 5 + dataRows.length - 1, c: 0 } });
  }

  ws['!merges'] = merges;

  // Border chung cho tất cả các ô
  const borderStyle = {
    top: { style: "thin", color: { rgb: "000000" } },
    bottom: { style: "thin", color: { rgb: "000000" } },
    left: { style: "thin", color: { rgb: "000000" } },
    right: { style: "thin", color: { rgb: "000000" } }
  };

  // Style definitions - Phương án 1: Tương phản chuyên nghiệp
  
  // Dòng 1: Tiêu đề chính
  const titleStyle = {
    font: { bold: true, sz: 16, color: { rgb: "FFFFFF" }, name: "Segoe UI" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "1F4E78" } }, // Xanh đậm chuẩn y tế
    border: borderStyle
  };

  // Dòng 2: Tên đơn vị
  const subtitleStyle = {
    font: { bold: true, sz: 14, color: { rgb: "1F4E78" }, name: "Segoe UI" },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "FFFFFF" } }, // Nền trắng - khoảng nghỉ mắt
    border: borderStyle
  };

  // Dòng 3: Ngày xuất (căn phải)
  const infoStyleRight = {
    font: { bold: false, sz: 11, color: { rgb: "000000" }, name: "Segoe UI" },
    alignment: { horizontal: "right", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "F2F2F2" } }, // Xám rất nhạt
    border: borderStyle
  };

  // Dòng 4: Tổng số (căn trái, in đậm số)
  const infoStyle = {
    font: { bold: true, sz: 11, color: { rgb: "000000" }, name: "Segoe UI" },
    alignment: { horizontal: "left", vertical: "center", wrapText: true },
    fill: { fgColor: { rgb: "F2F2F2" } }, // Xám rất nhạt
    border: borderStyle
  };

  const headerStyle = {
    font: { bold: true, color: { rgb: "FFFFFF" }, sz: 12 },
    fill: { fgColor: { rgb: "4472C4" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top: { style: "medium", color: { rgb: "000000" } },
      bottom: { style: "medium", color: { rgb: "000000" } },
      left: { style: "thin", color: { rgb: "000000" } },
      right: { style: "thin", color: { rgb: "000000" } }
    }
  };

  const dataStyle = {
    alignment: { horizontal: "center", vertical: "center" },
    border: borderStyle
  };

  const dataStyleAlt = {
    ...dataStyle,
    fill: { fgColor: { rgb: "F9FAFB" } }
  };

  // Styles cho dòng trạng thái cần theo dõi
  const warningStyle = {
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: borderStyle,
    fill: { fgColor: { rgb: "FFF3CD" } }, // Vàng nhạt
    font: { bold: true, color: { rgb: "856404" } }
  };

  const dangerStyle = {
    alignment: { horizontal: "center", vertical: "center" },
    border: borderStyle,
    fill: { fgColor: { rgb: "F8D7DA" } }, // Đỏ nhạt
    font: { bold: true, color: { rgb: "721C24" } }
  };

  const criticalStyle = {
    alignment: { horizontal: "center", vertical: "center" },
    border: borderStyle,
    fill: { fgColor: { rgb: "FF6B6B" } }, // Đỏ đậm
    font: { bold: true, color: { rgb: "FFFFFF" } }
  };

  // Function kiểm tra trạng thái
  const getRowStatus = (bpm, spo2, temp) => {
    // Chỉ kiểm tra các chỉ số có giá trị (> 0)
    const isBpmCritical = bpm > 0 && (bpm < 50 || bpm > 120);
    const isBpmWarning = bpm > 0 && ((bpm >= 50 && bpm < 60) || (bpm > 100 && bpm <= 120));
    const isSpo2Critical = spo2 > 0 && spo2 < 90;
    const isSpo2Warning = spo2 > 0 && (spo2 >= 90 && spo2 < 95);
    const isTempCritical = temp > 0 && (temp < 35 || temp > 37);
    const isTempWarning = false;

    // Kiểm tra xem có chỉ số nào được đo không
    const hasMeasurement = bpm > 0 || spo2 > 0 || temp > 0;
    
    if (!hasMeasurement) {
      return 'normal'; // Không có dữ liệu - hiển thị màu bình thường
    } else if (isBpmCritical || isSpo2Critical || isTempCritical) {
      return 'critical'; // Nguy hiểm
    } else if (isBpmWarning || isSpo2Warning || isTempWarning) {
      return 'warning'; // Trạng thái cần theo dõi
    } else {
      return 'normal'; // Bình thường
    }
  };

  // Apply styles to cells (cập nhật số hàng)
  const cellMap = {
    'A1': titleStyle,
    'A2': subtitleStyle,
    'A3': infoStyleRight, // Dòng 3: căn phải
    'A4': infoStyle       // Dòng 4: căn trái, in đậm
  };

  // Apply header style (row 5) - bao gồm cột H (8 cột)
  ['A5', 'B5', 'C5', 'D5', 'E5', 'F5', 'G5', 'H5'].forEach(cell => {
    if (ws[cell]) ws[cell].s = headerStyle;
  });

  // Apply data styles với highlight theo trạng thái (from row 6 onwards)
  for (let i = 0; i < dataRows.length; i++) {
    const rowNum = 6 + i;
    const record = records[i];
    const status = getRowStatus(record.bpm, record.spo2, record.temp);
    
    let rowStyle;
    if (status === 'critical') {
      rowStyle = criticalStyle;
    } else if (status === 'warning') {
      rowStyle = warningStyle;
    } else {
      rowStyle = i % 2 === 0 ? dataStyle : dataStyleAlt;
    }

    // Style đặc biệt cho cột Bệnh nhân (có vertical center cho merged cells)
    const patientCellStyle = {
      ...rowStyle,
      alignment: { horizontal: "center", vertical: "center" },
      font: { ...rowStyle.font, bold: true }
    };

    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].forEach(col => {
      const cellRef = `${col}${rowNum}`;
      if (ws[cellRef]) {
        // Cột A (Bệnh nhân) dùng style đặc biệt
        ws[cellRef].s = col === 'A' ? patientCellStyle : rowStyle;
      }
    });
  }

  // Apply info styles
  Object.keys(cellMap).forEach(cell => {
    if (ws[cell]) ws[cell].s = cellMap[cell];
  });

  XLSX.utils.book_append_sheet(wb, ws, 'Dữ liệu sức khỏe');
  
  // Xuất file
  XLSX.writeFile(wb, filename);
  
  console.log('✅ Đã xuất file Excel:', filename);
};

// Historical Data Modal Component (with Export CSV button)
const HistoricalDataModal = ({ date, readings, onClose }) => {
  const today = new Date();
  const isToday = getDocId(date) === getDocId(today);
  
  return (
    <div className="historical-data">
      <h3>
        {isToday ? 'Dữ liệu hôm nay' : `Lịch sử đo ngày ${date.toLocaleDateString('vi-VN')}`}
        <button className="close-btn" onClick={onClose}>&times;</button>
      </h3>

    {readings && readings.length > 0 && (
      <div style={{ marginBottom: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          className="glass-card"
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: 'none',
            background: 'linear-gradient(90deg,#ff6b81,#ff4d6d)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer'
          }}
          onClick={() => exportToCSV(readings, `lich_su_${date.toLocaleDateString('vi-VN')}.csv`)}
        >
          Xuất CSV
        </button>
        <small style={{ color: 'var(--text-color-lighter)' }}>Tải file CSV, mở bằng Google Sheets hoặc Excel</small>
      </div>
    )}

    <div className="readings-grid">
      {(!readings || readings.length === 0) && (
        <div style={{ 
          color: 'var(--text-color-light)', 
          textAlign: 'center',
          padding: '2rem',
          background: 'rgba(255, 193, 7, 0.1)',
          borderRadius: '12px',
          border: '1px dashed rgba(255, 193, 7, 0.3)'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
          <div style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.5rem' }}>
            {isToday ? 'Chưa có dữ liệu hôm nay' : 'Không có dữ liệu cho ngày này'}
          </div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>
            {isToday ? 'Hãy nhập tên bệnh nhân và ấn "▶️ Bắt đầu đo" để bắt đầu!' : 'Không có phiên đo nào được ghi nhận.'}
          </div>
        </div>
      )}
      {readings && readings.map((reading, index) => (
        <div key={index} className="reading-item">
          <div className="reading-time">
            {reading.timestamp && reading.timestamp.seconds ? new Date(reading.timestamp.seconds * 1000).toLocaleTimeString('vi-VN') : ''}
          </div>
          <div className="reading-value">
            {reading.bpm != null ? reading.bpm.toFixed(0) : '--'} BPM
          </div>
          <div className="reading-value">
            {reading.spo2 != null ? reading.spo2.toFixed(1) : '--'}%
          </div>
          <div className="reading-value">
            {reading.temp != null ? reading.temp.toFixed(1) : '--'}°C
          </div>
        </div>
      ))}
    </div>
  </div>
  );
};

function App() {
  // === STATE GỐC ===
  const [bpm, setBpm] = useState(0);
  const [spo2, setSpo2] = useState(0);
  const [temperature, setTemperature] = useState(0);
  const [activeChart, setActiveChart] = useState('bpm');
  // Patient Name State (Persisted in LocalStorage)
  const [patientName, setPatientName] = useState(() => {
    const savedName = localStorage.getItem('patientName') || '';
    return savedName === 'Nguyễn Văn A' ? '' : savedName;
  });
  useEffect(() => localStorage.setItem('patientName', patientName), [patientName]);
  
  // Patient Age State (Persisted in LocalStorage)
  const [patientAge, setPatientAge] = useState(() => localStorage.getItem('patientAge') || '');
  useEffect(() => localStorage.setItem('patientAge', patientAge), [patientAge]);
  
  // Patient Gender State (Persisted in LocalStorage)
  const [patientGender, setPatientGender] = useState(() => localStorage.getItem('patientGender') || 'Nam');
  useEffect(() => localStorage.setItem('patientGender', patientGender), [patientGender]);
  // Separate chart states so all three charts run concurrently
  const [bpmChartData, setBpmChartData] = useState(createInitialChartData('bpm'));
  const [spo2ChartData, setSpo2ChartData] = useState(createInitialChartData('spo2'));
  const [tempChartData, setTempChartData] = useState(createInitialChartData('temp'));
  const [connectionStatus, setConnectionStatus] = useState('Đang kết nối...');
  const [isEsp32Online, setIsEsp32Online] = useState(false);

  // Thêm states mới
  const [showAlert, setShowAlert] = useState(false);
  const [alertMessage, setAlertMessage] = useState('');
  const [showHistorical, setShowHistorical] = useState(false);
  const [historicalReadings, setHistoricalReadings] = useState([]);
  
  // Save status states
  const [saveStatus, setSaveStatus] = useState('waiting'); // 'waiting', 'saving', 'saved', 'error'
  const [lastSavedTime, setLastSavedTime] = useState(null);
  const [recordsSavedToday, setRecordsSavedToday] = useState(0);
  // Measurement session states
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measurementStartTime, setMeasurementStartTime] = useState(null);
  
  // States cho đo riêng lẻ từng chỉ số
  const [isMeasuringBpm, setIsMeasuringBpm] = useState(false);
  const [isMeasuringSpo2, setIsMeasuringSpo2] = useState(false);
  const [isMeasuringTemp, setIsMeasuringTemp] = useState(false);

  // === Toast state (thay alert browser) ===
  const [toast, setToast] = useState(null);
  useEffect(() => {
    let timeoutId;
    const handler = (e) => {
      clearTimeout(timeoutId);
      setToast(e.detail);
      timeoutId = setTimeout(() => setToast(null), e.detail.duration || 3500);
    };
    window.addEventListener('app-toast', handler);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('app-toast', handler);
    };
  }, []);

  // === Bỏ Count-up để hiển thị ngay lập tức (Real-time căng nhất) ===
  const bpmDisplay = bpm > 0 ? bpm : 0;
  const spo2Display = spo2 > 0 ? spo2 : 0;
  const tempDisplay = temperature > 0 ? temperature : 0;

  // === STATE MỚI CHO LỊCH SỬ & FIREBASE ===
  const [userId, setUserId] = useState(null);
  const [viewMode, setViewMode] = useState('live');
  // store selectedDate as local date at midnight to avoid timezone artifacts
  const todayLocal = new Date();
  const todayLocalMidnight = new Date(todayLocal.getFullYear(), todayLocal.getMonth(), todayLocal.getDate());
  const [selectedDate, setSelectedDate] = useState(todayLocalMidnight);
  const isSelectedFutureDate = selectedDate > todayLocalMidnight;
  const hasHistoricalReadings = historicalReadings.length > 0;
  const canStartMeasurement = viewMode === 'live' && isEsp32Online;
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // === REFs ĐỂ LƯU DỮ LIỆU ===
  const dataBufferRef = useRef([]);
  const lastLiveBpmRef = useRef(0);
  const lastLiveSpo2Ref = useRef(0);
  const lastLiveTempRef = useRef(0);
  // Smooth SpO2 interpolation
  const smoothSpo2Ref = useRef(0);
  const targetSpo2Ref = useRef(0);
  // Smooth Temperature interpolation
  const smoothTempRef = useRef(0);
  const targetTempRef = useRef(0);
  
  // Ref to store latest saveToFirestore function
  const saveToFirestoreRef = useRef(null);

  const bpmRef = useRef(0);
  const waveformPhaseRef = useRef(0);
  // (🎨 NEW) Ref để lưu biên độ sóng hiện tại
  // Amplitude phản ánh BPM: 60 BPM → 0.6, 80 BPM → 1.0, 100 BPM → 1.4
  // Mô phỏng chuẩn y sinh: nhịp nhanh hơn = sóng mạnh hơn
  // HRV (±15%): Mỗi đỉnh sóng cao thấp khác nhau - phản ánh biến thiên tự nhiên
  const waveformAmplitudeRef = useRef(1.0);
  // Respiratory phase for SpO2 variation
  const respiratoryPhaseRef = useRef(0);
  // Thermal phase for temperature variation
  const thermalPhaseRef = useRef(0);
  // Timestamp of last received websocket message (ms)
  const lastMessageTsRef = useRef(Date.now());
  // Timestamp of last save to Firestore (throttle)
  const lastSaveTimeRef = useRef(0);

  // === 8. EFFECT: ĐĂNG NHẬP FIREBASE ===
  useEffect(() => {
    console.log("🔍 Firebase useEffect chạy, isCanvasEnvironment:", isCanvasEnvironment, "auth:", !!auth);
    if (!isCanvasEnvironment || !auth) {
      console.log("Bỏ qua đăng nhập Firebase (chạy trên localhost).");
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        console.log("✅ Firebase Đã đăng nhập, User ID:", user.uid);
        console.log("🔍 Đang gọi setUserId với:", user.uid);
        setUserId(user.uid);
        console.log("🔍 Đã gọi xong setUserId");
      } else {
        console.log("Firebase đã đăng xuất.");
        setUserId(null);
      }
    });
    const signIn = async () => {
      try {
        await signInAnonymously(auth);
      } catch (error) {
        console.error("❌ Lỗi đăng nhập Firebase:", error);
      }
    };
    if (!auth.currentUser) {
      signIn();
    }
    return () => unsubscribe();
  }, []);

  // === DEBUG: Track userId changes ===
  useEffect(() => {
    console.log("🔍 userId state đã thay đổi:", userId, "type:", typeof userId);
  }, [userId]);

  // === 9. HÀM LƯU DỮ LIỆU VÀO FIREBASE ===
  const saveToFirestore = useCallback(async (bpmValue, spo2Value, tempValue) => {
    // Debug: Kiểm tra điều kiện
    console.log('🔍 saveToFirestore called:', { 
      userId: userId, 
      userIdType: typeof userId,
      db: !!db, 
      viewMode, 
      isMeasuring,
      isMeasuringBpm,
      isMeasuringSpo2,
      isMeasuringTemp,
      bpm: bpmValue,
      spo2: spo2Value,
      temp: tempValue
    });
    
    if (!userId) {
      console.log('⚠️ Không có userId - chưa đăng nhập Firebase');
      return;
    }
    if (!db) {
      console.log('⚠️ Không có db - Firebase chưa khởi tạo');
      return;
    }
    if (viewMode !== 'live') {
      console.log('⚠️ Không ở chế độ live');
      return;
    }
    // Chấp nhận nếu đang đo tổng HOẶC đang đo bất kỳ chỉ số nào
    if (!isMeasuring && !isMeasuringBpm && !isMeasuringSpo2 && !isMeasuringTemp) {
      console.log('⚠️ Chưa bắt đầu đo - Hãy ấn "▶️ Bắt đầu đo" hoặc đo riêng từng chỉ số');
      return;
    }
    
    // Throttle: chỉ lưu mỗi 10 giây
    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;
    if (timeSinceLastSave < 10000) {
      console.log(`⏳ Throttle: còn ${Math.ceil((10000 - timeSinceLastSave) / 1000)}s nữa mới lưu`);
      return;
    }
    
    lastSaveTimeRef.current = now;
    setSaveStatus('saving');
    console.log(`💾 Đang lưu: BPM=${bpmValue}, SpO2=${spo2Value}, Temp=${tempValue}`);
    
    const newRecord = {
      timestamp: Timestamp.now(),
      bpm: parseFloat(bpmValue.toFixed(1)),
      spo2: parseFloat(spo2Value.toFixed(1)),
      temp: parseFloat(tempValue.toFixed(1)),
      patientName: patientName.trim(),
      patientAge: patientAge.trim(),
      patientGender: patientGender
    };
    
    const docId = getDocId(new Date());
    const docPath = `artifacts/${appId}/users/${userId}/health_data/${docId}`;
    console.log(`📂 Firestore path: ${docPath}`);
    const docRef = doc(db, docPath);
    
    try {
      await setDoc(docRef, {
        records: arrayUnion(newRecord)
      }, { merge: true });
      console.log("✅ Lưu thành công!");
      setSaveStatus('saved');
      setLastSavedTime(new Date());
      setRecordsSavedToday(prev => prev + 1);
      setTimeout(() => setSaveStatus('waiting'), 3000);
    } catch (error) {
      console.error("❌ Lỗi lưu Firestore:", error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('waiting'), 5000);
    }
  }, [userId, db, viewMode, isMeasuring, isMeasuringBpm, isMeasuringSpo2, isMeasuringTemp, patientName, patientAge, patientGender]);
  
  // Update ref whenever saveToFirestore changes
  useEffect(() => {
    saveToFirestoreRef.current = saveToFirestore;
  }, [saveToFirestore]);

  // === 9b. EFFECT: LEGACY BUFFER CLEANUP (GIỮ ĐỂ AN TOÀN) ===
  useEffect(() => {
    const flushBufferToFirestore = async () => {
      if (!userId || dataBufferRef.current.length === 0 || viewMode !== 'live' || !db) {
        if (!db && dataBufferRef.current.length > 0) {
          console.log("Có dữ liệu buffer, nhưng db không khởi tạo (localhost). Hủy ghi.");
        }
        return;
      }
      
      setSaveStatus('saving');
      console.log(`Đang ghi ${dataBufferRef.current.length} điểm dữ liệu vào Firestore...`);
      const buffer = [...dataBufferRef.current];
      dataBufferRef.current = [];
      const avgBpm = buffer.reduce((acc, val) => acc + val.bpm, 0) / buffer.length;
      const avgSpo2 = buffer.reduce((acc, val) => acc + val.spo2, 0) / buffer.length;
      const avgTemp = buffer.reduce((acc, val) => acc + val.temp, 0) / buffer.length;
      const newRecord = {
        timestamp: Timestamp.now(),
        bpm: parseFloat(avgBpm.toFixed(1)),
        spo2: parseFloat(avgSpo2.toFixed(1)),
        temp: parseFloat(avgTemp.toFixed(1)),
        patientName: patientName.trim()
      };
      const docId = getDocId(new Date());
      const docPath = `artifacts/${appId}/users/${userId}/health_data/${docId}`;
      const docRef = doc(db, docPath);
      try {
        await setDoc(docRef, {
          records: arrayUnion(newRecord)
        }, { merge: true });
        console.log("✅ Ghi dữ liệu vào Firestore thành công!");
        setSaveStatus('saved');
        setLastSavedTime(new Date());
        setRecordsSavedToday(prev => prev + 1);
        // Reset về waiting sau 3s
        setTimeout(() => setSaveStatus('waiting'), 3000);
      } catch (error) {
        console.error("❌ Lỗi ghi Firestore:", error);
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('waiting'), 5000);
      }
    };
    // Chỉ flush khi tắt trang (backup safety)
    const handleBeforeUnload = (e) => {
      if (dataBufferRef.current.length > 0 && userId && db && viewMode === 'live') {
        flushBufferToFirestore();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [userId, viewMode, patientName, patientAge, patientGender]);

  // Helper to push a numeric value into a specific chart state (always updates)
  const pushToChartState = (setter, value) => {
    if (value === null || typeof value === 'undefined') return;
    setter(prev => {
      const newData = [...prev.datasets[0].data];
      newData.shift();
      newData.push(value);
      return { ...prev, datasets: [{ ...prev.datasets[0], data: newData }] };
    });
  };

  // === 10. EFFECT: KẾT NỐI FIREBASE (REAL-TIME THAY CHO WEBSOCKET) ===
  useEffect(() => {
    // Chắc chắn firebase đã sẵn sàng
    if (!db) return;

    setConnectionStatus('Đang chờ dữ liệu từ Firebase...');
    setIsEsp32Online(false);
    
    // Trỏ tới đúng Document mà ESP32 vừa nạp lên
    const docRef = doc(db, 'realtime_data', 'esp32_sensor');
    
    let offlineTimeoutId;
    let isFirstSnapshot = true;

    const markEsp32Offline = () => {
      setIsEsp32Online(false);
      setConnectionStatus('Thiết bị ESP32 đang tắt/Mất mạng!');
      setIsMeasuring(false);
      setIsMeasuringBpm(false);
      setIsMeasuringSpo2(false);
      setIsMeasuringTemp(false);
      setMeasurementStartTime(null);
      setSaveStatus('waiting');
      if (viewMode === 'live') {
        setBpm(0);
        setSpo2(0);
        setTemperature(0);
        bpmRef.current = 0;
        targetSpo2Ref.current = 0;
        targetTempRef.current = 0;
      }
    };

    // Mở luồng lắng nghe thời gian thực của Firebase
    const unsubscribe = onSnapshot(docRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();

        let newBpm = Number(data.bpm) || 0;
        let newSpo2 = Number(data.spo2) || 0;
        let newTemp = Number(data.temp) || 0;
        let uptime = Number(data.uptime) || 0;

        // Xóa bộ đếm ngược mất kết nối mỗi khi Firebase có tín hiệu cập nhật
        clearTimeout(offlineTimeoutId);

        if (isFirstSnapshot) {
          isFirstSnapshot = false;
          setIsEsp32Online(false);
          setConnectionStatus('Đang kết nối!');
          if (viewMode === 'live') {
            setBpm(0);
            setSpo2(0);
            setTemperature(0);
            bpmRef.current = 0;
            targetSpo2Ref.current = 0;
            targetTempRef.current = 0;
          }
          offlineTimeoutId = setTimeout(markEsp32Offline, 5000);
          return;
        }

        // Kích hoạt lại bộ đếm: Sau 5 giây nếu Firebase không có dữ liệu mới -> rớt mạng
        offlineTimeoutId = setTimeout(markEsp32Offline, 5000);

        lastMessageTsRef.current = Date.now();
        setIsEsp32Online(true);
        setConnectionStatus('Đã kết nối ESP32 (Online)');

        // Lưu buffer lưu trữ lịch sử
        if (isCanvasEnvironment && (newBpm > 0 || newSpo2 > 0 || newTemp > 0)) {
          dataBufferRef.current.push({ bpm: newBpm, spo2: newSpo2, temp: newTemp });
          if (saveToFirestoreRef.current) {
            saveToFirestoreRef.current(newBpm, newSpo2, newTemp);
          }
        }

        // Đẩy số liệu ra giao diện nếu đang ở Live View
        if (viewMode === 'live') {
          setBpm(newBpm);
          setSpo2(newSpo2);
          setTemperature(newTemp);

          bpmRef.current = newBpm;
          lastLiveBpmRef.current = newBpm;
          lastLiveSpo2Ref.current = newSpo2;
          lastLiveTempRef.current = newTemp;

          if (newSpo2 > 0) {
            targetSpo2Ref.current = newSpo2;
            if (smoothSpo2Ref.current === 0) smoothSpo2Ref.current = newSpo2;
          } else {
            targetSpo2Ref.current = 0;
          }
          
          if (newTemp > 0) {
            targetTempRef.current = newTemp;
            if (smoothTempRef.current === 0) smoothTempRef.current = newTemp;
          } else {
            targetTempRef.current = 0;
          }
        }
      } else {
        isFirstSnapshot = false;
        setIsEsp32Online(false);
        setConnectionStatus('Chưa có dữ liệu cảm biến mới');
      }
    }, (error) => {
      console.error("Lỗi nhận Firebase Realtime:", error);
      setIsEsp32Online(false);
      setConnectionStatus('Mất kết nối với Firebase');
    });

    // Cleanup: Ngắt kết nối Firebase khi chuyển giao diện
    return () => {
      unsubscribe();
      clearTimeout(offlineTimeoutId);
    };
  }, [viewMode]); // 🔧 Chỉ reconnect khi viewMode thay đổi, dùng ref cho saveToFirestore

  useEffect(() => {
    const generatePpgPoint = (phase) => {
      // Synthetic PPG: Systolic peak + Dicrotic notch
      // Normalized phase 0..1
      const x = phase;
      const baseline = 0.3; // Baseline thấp hơn để thấy rõ sự khác biệt amplitude

      // Main systolic peak (around 0.15) - đỉnh chính
      // Gaussian function: a * exp(-(x-b)^2 / 2c^2)
      const amp = waveformAmplitudeRef.current; // 0.6-1.4 dựa trên BPM
      const systolic = (1.5 * amp) * Math.exp(-Math.pow(x - 0.12, 2) / 0.008);

      // Dicrotic notch/wave (around 0.38) - đỉnh phụ
      const dicrotic = (0.4 * amp) * Math.exp(-Math.pow(x - 0.38, 2) / 0.015);

      return baseline + systolic + dicrotic;
    };

    if (viewMode !== 'live') return;

    let animationFrameId;
    let lastTime = performance.now();
    // Smooth BPM prevents the wave from jumping instantly when BPM changes
    let smoothBpm = bpmRef.current;

    const animate = (time) => {
      const deltaTime = (time - lastTime) / 1000; // seconds
      lastTime = time;

      // 1. Smoothly interpolate smoothBpm towards the real bpmRef.current
      // LERP factor 0.05 means it closes 5% of the gap per frame (~60fps)
      // This makes the transition smooth even if sensor data jumps or is 0
      const targetBpm = bpmRef.current;
      const diff = targetBpm - smoothBpm;

      // If gap is small, snap to it, otherwise interpolate
      if (Math.abs(diff) < 0.5) smoothBpm = targetBpm;
      else smoothBpm += diff * 0.05;

      let newPpgValue = 0.5;

      // Only advance phase if we have a "meaningful" speed (> 10 bpm)
      // If bpm is 0, smoothBpm will slowly decay to 0, slowing the wave to a stop naturally
      if (smoothBpm > 10) {
        const beatsPerSecond = smoothBpm / 60.0;
        const phaseIncrement = beatsPerSecond * deltaTime;
        const prevPhase = waveformPhaseRef.current;
        waveformPhaseRef.current = (prevPhase + phaseIncrement) % 1.0;

        // Nếu qua chu kỳ mới, tính amplitude dựa trên BPM
        if (waveformPhaseRef.current < prevPhase) {
          // Map BPM (60-100) vào amplitude (0.6-1.4)
          // BPM thấp (60) -> amplitude 0.6 (sóng thấp)
          // BPM cao (100) -> amplitude 1.4 (sóng cao)
          const normalizedBpm = Math.max(50, Math.min(120, smoothBpm)); // clamp
          const baseAmplitude = 0.6 + ((normalizedBpm - 60) / 40) * 0.8; // linear map
          
          // Tăng biến thiên tự nhiên (±15%) - Heart Rate Variability rõ rệt
          // Mỗi nhịp sẽ có độ cao khác nhau đáng kể
          const variation = 0.85 + Math.random() * 0.3; // ±15%
          
          // Thêm slow breathing wave (respiratory sinus arrhythmia)
          // Chu kỳ thở ~3-4 giây tạo biến thiên chậm
          const breathingWave = 0.92 + 0.16 * Math.sin(time * 0.0012);
          
          waveformAmplitudeRef.current = baseAmplitude * variation * breathingWave;
        }

        // 2. Tạo tín hiệu cơ bản
        const rawPpg = generatePpgPoint(waveformPhaseRef.current);

        // 3. Thêm Baseline Wander (Mô phỏng nhịp thở)
        // Giảm biên độ trôi để sóng ổn định hơn (0.05)
        const baselineWander = 0.05 * Math.sin(time * 0.0015);

        // 4. Thêm Noise (Nhiễu tín hiệu) + micro-variations
        // Noise nhẹ + biến thiên nhỏ theo phase để tạo sự không đồng đều tự nhiên
        const noise = (Math.random() - 0.5) * 0.04;
        const microVariation = 0.03 * Math.sin(waveformPhaseRef.current * 12.566); // subtle

        // Tổng hợp tín hiệu
        newPpgValue = rawPpg + baselineWander + noise + microVariation;

        // Clamp để không bị âm quá mức hoặc quá cao (dù chart auto scale nhưng an toàn hơn)
        newPpgValue = Math.max(0.05, newPpgValue);
      } else {
        // When stopped, reset phase slowly or just hold baseline
        waveformPhaseRef.current = 0;
      }

      setBpmChartData(prev => {
        const wave = [...(prev.datasets[0]?.data || Array(280).fill(null))];

        wave.shift();
        wave.push(newPpgValue);

        return { 
          ...prev, 
          datasets: [{ ...prev.datasets[0], data: wave }]
        };
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    animationFrameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(animationFrameId);
  }, [viewMode, activeChart]);

  // === EFFECT: SpO2 Smooth Animation ===
  useEffect(() => {
    if (viewMode !== 'live') return;

    let animationId;
    let lastTime = performance.now();

    const animateSpo2 = (time) => {
      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;

      // 1. Smooth interpolation towards target (LERP 2% per frame)
      const target = targetSpo2Ref.current;
      const current = smoothSpo2Ref.current;
      const diff = target - current;
      
      if (Math.abs(diff) < 0.05) {
        smoothSpo2Ref.current = target;
      } else {
        smoothSpo2Ref.current += diff * 0.02; // Very slow, smooth transition
      }

      // 2. Respiratory variation (±0.3-0.8% due to breathing)
      respiratoryPhaseRef.current += deltaTime * 0.3; // ~3-4s breathing cycle
      const respiratoryVariation = 0.55 * Math.sin(respiratoryPhaseRef.current);
      
      // 3. Micro noise (sensor noise)
      const noise = (Math.random() - 0.5) * 0.15;

      // 4. Final value
      let pushedValue = null;
      if (target > 0) {
        const finalSpo2 = smoothSpo2Ref.current + respiratoryVariation + noise;
        pushedValue = Math.max(80, Math.min(100, finalSpo2));
      } else {
        smoothSpo2Ref.current = 0;
      }

      // 5. Update chart
      setSpo2ChartData(prev => {
        const data = [...(prev.datasets[0]?.data || Array(280).fill(null))];
        data.shift();
        data.push(pushedValue);
        return { 
          ...prev, 
          datasets: [{ ...prev.datasets[0], data }]
        };
      });

      animationId = requestAnimationFrame(animateSpo2);
    };

    animationId = requestAnimationFrame(animateSpo2);
    return () => cancelAnimationFrame(animationId);
  }, [viewMode]);

  // === EFFECT: Temperature Smooth Animation ===
  useEffect(() => {
    if (viewMode !== 'live') return;

    let animationId;
    let lastTime = performance.now();

    const animateTemp = (time) => {
      const deltaTime = (time - lastTime) / 1000;
      lastTime = time;

      // 1. Very slow smooth interpolation (temperature changes slowly!)
      const target = targetTempRef.current;
      const current = smoothTempRef.current;
      const diff = target - current;
      
      if (Math.abs(diff) < 0.01) {
        smoothTempRef.current = target;
      } else {
        smoothTempRef.current += diff * 0.01; // Extremely slow (1% per frame)
      }

      // 2. Natural thermal variation (±0.1-0.15°C)
      // Nhiệt độ cơ thể biến thiên rất nhỏ, chậm
      thermalPhaseRef.current += deltaTime * 0.1; // Very slow cycle (~10s)
      const thermalVariation = 0.12 * Math.sin(thermalPhaseRef.current);
      
      // 3. Micro noise (sensor accuracy ±0.05°C)
      const noise = (Math.random() - 0.5) * 0.05;

      // 4. Circadian rhythm effect (very subtle)
      const circadianEffect = 0.08 * Math.sin(time * 0.0001);

      // 5. Final value
      let pushedValue = null;
      if (target > 0) {
        const finalTemp = smoothTempRef.current + thermalVariation + noise + circadianEffect;
        pushedValue = Math.max(30, Math.min(45, finalTemp));
      } else {
        smoothTempRef.current = 0;
      }

      // 6. Update chart
      setTempChartData(prev => {
        const data = [...(prev.datasets[0]?.data || Array(280).fill(null))];
        data.shift();
        data.push(pushedValue);
        return { 
          ...prev, 
          datasets: [{ ...prev.datasets[0], data }]
        };
      });

      animationId = requestAnimationFrame(animateTemp);
    };

    animationId = requestAnimationFrame(animateTemp);
    return () => cancelAnimationFrame(animationId);
  }, [viewMode]);

  // === 10c. EFFECT: KIỂM TRA MẤT TÍN HIỆU (LOSS OF SIGNAL) ===
  useEffect(() => {
    if (viewMode !== 'live') return;
    const TIMEOUT_MS = 5000; // 5s không nhận message -> coi là mất tín hiệu
    const checkInterval = 1000; // kiểm tra mỗi 1s
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastMessageTsRef.current > TIMEOUT_MS) {
        // only act if we previously had a non-zero bpm
        if (bpmRef.current !== 0) {
          // update refs and states
          bpmRef.current = 0;
          setBpm(0);
          // update bpmChartData: waveform -> 0, numeric -> 0
          setBpmChartData(prev => {
            const wave = [...(prev.datasets[0]?.data || Array(280).fill(null))];
            wave.shift(); 
            wave.push(0.2); // baseline khi mất tín hiệu
            return { 
              ...prev, 
              datasets: [{ ...prev.datasets[0], data: wave }]
            };
          });
          setConnectionStatus('Mất tín hiệu cảm biến');
          setAlertMessage('Mất tín hiệu cảm biến — nhịp tim về 0');
          setShowAlert(true);
          setTimeout(() => setShowAlert(false), 3000);
        }
      }
    }, checkInterval);
    return () => clearInterval(id);
  }, [viewMode]);


  // === 11. EFFECT: TẢI DỮ LIỆU LỊCH SỬ (DATABASE READER) ===

  // (🎨 ĐÃ SỬA: Hàm trợ giúp tạo biểu đồ Lịch sử)
  const createHistoricalChart = (records, chartType) => {
    // build 280-point array for Chart.js
    const chartPoints = Array(280).fill(null);
    if (records && records.length > 0) {
      const historicalData = records.map(r => r[chartType]);
      const dataToShow = historicalData.slice(-280);
      chartPoints.splice(280 - dataToShow.length, dataToShow.length, ...dataToShow);
    }

    // For BPM history, return a single numeric dataset (one Y axis) for clarity
    if (chartType === 'bpm') {
      const bpmNumeric = {
        label: 'Nhịp tim (BPM)',
        data: chartPoints,
        borderColor: 'rgba(255, 77, 109, 0.9)',
        backgroundColor: 'rgba(255, 77, 109, 0.08)',
        tension: 0.2,
        fill: true,
        pointRadius: 1,
        borderWidth: 2,
        yAxisID: 'y'
      };
      return { labels: Array(280).fill(''), datasets: [bpmNumeric] };
    }

    // SPO2 / Temp history (single numeric axis)
    if (chartType === 'spo2') {
      return {
        labels: Array(280).fill(''),
        datasets: [{
          label: 'Lịch sử SpO₂ (%)',
          data: chartPoints,
          borderColor: 'rgba(0, 180, 216, 0.8)',
          backgroundColor: 'rgba(0, 180, 216, 0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 1,
          borderWidth: 2,
          yAxisID: 'y'
        }]
      };
    }

    if (chartType === 'temp') {
      return {
        labels: Array(280).fill(''),
        datasets: [{
          label: 'Lịch sử Nhiệt độ (°C)',
          data: chartPoints,
          borderColor: 'rgba(255, 159, 28, 0.8)',
          backgroundColor: 'rgba(255, 159, 28, 0.08)',
          tension: 0.4,
          fill: true,
          pointRadius: 1,
          borderWidth: 2,
          yAxisID: 'y'
        }]
      };
    }

    // fallback
    return {
      labels: Array(280).fill(''),
      datasets: [{
        label: 'Dữ liệu',
        data: chartPoints,
        borderColor: 'rgba(100,100,100,0.8)',
        backgroundColor: 'rgba(100,100,100,0.05)',
        tension: 0.2,
        fill: true,
        pointRadius: 1,
        borderWidth: 2,
        yAxisID: 'y'
      }]
    };
  };

  useEffect(() => {
    const updateUIWithHistoricalData = (records) => {
      if (!records || records.length === 0) {
        setBpm(0); setSpo2(0); setTemperature(0);
        // If no historical records, show empty numeric historical charts (single numeric axis)
        setBpmChartData(createHistoricalChart([], 'bpm'));
        setSpo2ChartData(createHistoricalChart([], 'spo2'));
        setTempChartData(createHistoricalChart([], 'temp'));
        return;
      }

      const avgBpm = records.reduce((acc, val) => acc + val.bpm, 0) / records.length;
      const avgSpo2 = records.reduce((acc, val) => acc + val.spo2, 0) / records.length;
      const avgTemp = records.reduce((acc, val) => acc + val.temp, 0) / records.length;

      setBpm(avgBpm);
      setSpo2(avgSpo2);
      setTemperature(avgTemp);

      // (🎨 ĐÃ SỬA: Vẽ đúng biểu đồ lịch sử cho từng loại)
      setBpmChartData(createHistoricalChart(records, 'bpm'));
      setSpo2ChartData(createHistoricalChart(records, 'spo2'));
      setTempChartData(createHistoricalChart(records, 'temp'));
    };

    const fetchHistoricalData = async () => {
      if (viewMode !== 'historical' || !userId || !db) {
        updateUIWithHistoricalData(null);
        return;
      }

      const currentDay = new Date();
      const currentDayMidnight = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
      if (selectedDate > currentDayMidnight) {
        updateUIWithHistoricalData(null);
        return;
      }

      console.log(`Đang tải dữ liệu cho ngày: ${getDocId(selectedDate)}`);
      setIsLoadingHistory(true);
      // Reset all chart states (we maintain separate states for each chart)
      setBpmChartData(createInitialChartData('bpm'));
      setSpo2ChartData(createInitialChartData('spo2'));
      setTempChartData(createInitialChartData('temp'));

      const docId = getDocId(selectedDate);
      const docPath = `artifacts/${appId}/users/${userId}/health_data/${docId}`;
      const docRef = doc(db, docPath);

      try {
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          console.log("✅ Tải lịch sử thành công:", data.records);
          updateUIWithHistoricalData(data.records);
        } else {
          console.log("Không tìm thấy dữ liệu cho ngày này.");
          updateUIWithHistoricalData(null);
        }
      } catch (error) {
        console.error("❌ Lỗi tải lịch sử:", error);
        updateUIWithHistoricalData(null);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    fetchHistoricalData();
    // (🎨 ĐÃ SỬA: Chạy lại effect này khi activeChart thay đổi)
  }, [selectedDate, viewMode, userId, activeChart]);

  // === 12. HÀM XỬ LÝ SỰ KIỆN ===
  const validateReadyToMeasure = () => {
    if (!patientName.trim()) {
      showToast('Vui lòng nhập tên bệnh nhân trước!', 'warning');
      return false;
    }

    if (!canStartMeasurement) {
      showToast('Chưa nhận được dữ liệu từ ESP32. Hãy bật thiết bị và chờ trạng thái Online.', 'warning');
      return false;
    }

    return true;
  };

  // Handler bắt đầu/dừng đo
  const startMeasurement = () => {
    if (!validateReadyToMeasure()) return;
    setIsMeasuring(true);
    // Khi đo tổng, tắt các đo riêng lẻ
    setIsMeasuringBpm(false);
    setIsMeasuringSpo2(false);
    setIsMeasuringTemp(false);
    setMeasurementStartTime(new Date());
    setRecordsSavedToday(0); // Reset counter cho phiên mới
    setSaveStatus('waiting');
    console.log(`🎬 Bắt đầu đo TOÀN BỘ cho bệnh nhân: ${patientName}`);
  };

  const stopMeasurement = () => {
    setIsMeasuring(false);
    setMeasurementStartTime(null);
    console.log(`⏹️ Dừng đo TOÀN BỘ`);
  };

  // Hàm đo riêng từng chỉ số
  const startMeasuringBpm = () => {
    if (!validateReadyToMeasure()) return;
    // Tắt đo tổng khi đo riêng
    if (isMeasuring) setIsMeasuring(false);
    setIsMeasuringBpm(true);
    if (!measurementStartTime) setMeasurementStartTime(new Date());
    if (recordsSavedToday === 0) setRecordsSavedToday(0); // Reset nếu phiên mới
    setSaveStatus('waiting');
    console.log(`💓 Bắt đầu đo BPM cho bệnh nhân: ${patientName}`);
  };

  const stopMeasuringBpm = () => {
    setIsMeasuringBpm(false);
    // Nếu không còn chỉ số nào đang đo, reset thời gian
    if (!isMeasuringSpo2 && !isMeasuringTemp && !isMeasuring) {
      setMeasurementStartTime(null);
    }
    console.log(`⏹️ Dừng đo BPM`);
  };

  const startMeasuringSpo2 = () => {
    if (!validateReadyToMeasure()) return;
    // Tắt đo tổng khi đo riêng
    if (isMeasuring) setIsMeasuring(false);
    setIsMeasuringSpo2(true);
    if (!measurementStartTime) setMeasurementStartTime(new Date());
    if (recordsSavedToday === 0) setRecordsSavedToday(0);
    setSaveStatus('waiting');
    console.log(`🫁 Bắt đầu đo SpO2 cho bệnh nhân: ${patientName}`);
  };

  const stopMeasuringSpo2 = () => {
    setIsMeasuringSpo2(false);
    if (!isMeasuringBpm && !isMeasuringTemp && !isMeasuring) {
      setMeasurementStartTime(null);
    }
    console.log(`⏹️ Dừng đo SpO2`);
  };

  const startMeasuringTemp = () => {
    if (!validateReadyToMeasure()) return;
    // Tắt đo tổng khi đo riêng
    if (isMeasuring) setIsMeasuring(false);
    setIsMeasuringTemp(true);
    if (!measurementStartTime) setMeasurementStartTime(new Date());
    if (recordsSavedToday === 0) setRecordsSavedToday(0);
    setSaveStatus('waiting');
    console.log(`🌡️ Bắt đầu đo Nhiệt độ cho bệnh nhân: ${patientName}`);
  };

  const stopMeasuringTemp = () => {
    setIsMeasuringTemp(false);
    if (!isMeasuringBpm && !isMeasuringSpo2 && !isMeasuring) {
      setMeasurementStartTime(null);
    }
    console.log(`⏹️ Dừng đo Nhiệt độ`);
  };

  const handlePatientNameKeyPress = (e) => {
    if (e.key === 'Enter' && patientName.trim()) {
      startMeasurement();
    }
  };

  const handleDateSelect = async (date) => {
    console.log("Đã chọn ngày:", date);
    // normalize selected date to local midnight to keep comparisons consistent
    const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    setSelectedDate(normalized);

    const todayStr = getDocId(new Date());
    const selectedStr = getDocId(date);
    const selectedIsFuture = normalized > new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    if (todayStr === selectedStr) {
      console.log("Ngày hôm nay - chuyển về chế độ LIVE");
      // Chuyển về live mode
      setViewMode('live');
      if (db && userId) {
        const docPath = `artifacts/${appId}/users/${userId}/health_data/${selectedStr}`;
        const docRef = doc(db, docPath);
        try {
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setHistoricalReadings(data.records || []);
            setShowHistorical(true);
          } else {
            showToast('Chưa có dữ liệu cho hôm nay. Hãy bắt đầu đo!', 'info');
          }
        } catch (error) {
          console.error('Lỗi khi tải dữ liệu:', error);
        }
      }
    } else if (selectedIsFuture) {
      console.log("Ngày tương lai - chưa có dữ liệu đo");
      setViewMode('historical');
      setHistoricalReadings([]);
      setShowHistorical(false);
      setBpmChartData(createHistoricalChart([], 'bpm'));
      setSpo2ChartData(createHistoricalChart([], 'spo2'));
      setTempChartData(createHistoricalChart([], 'temp'));
      showToast('CHƯA TỚI NGÀY ĐO!', 'info');
    } else {
      console.log("Chuyển sang chế độ LỊCH SỬ");
      setViewMode('historical');

      // Fetch lịch sử chi tiết
      if (db && userId) {
        const docPath = `artifacts/${appId}/users/${userId}/health_data/${selectedStr}`;
        const docRef = doc(db, docPath);

        try {
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setHistoricalReadings(data.records);
            setShowHistorical(true);
          } else {
            console.log("Không có dữ liệu cho ngày này");
            setHistoricalReadings([]);
          }
        } catch (error) {
          console.error("Lỗi khi tải dữ liệu lịch sử:", error);
        }
      }
    }
  };

  // (🎨 ĐÃ SỬA: Hàm chọn biểu đồ)
  const handleChartSelect = (type) => {
    if (viewMode === 'live') {
      console.log("Chuyển biểu đồ live sang:", type);
      // Reset only the selected chart's data (other charts keep running)
      if (type === 'bpm') setBpmChartData(createInitialChartData('bpm'));
      else if (type === 'spo2') setSpo2ChartData(createInitialChartData('spo2'));
      else setTempChartData(createInitialChartData('temp'));
    }
    // Cập nhật state (cho cả live và historical)
    setActiveChart(type);
  };


  // Kiểm tra và hiển thị trạng thái cần chú ý
  const checkAndShowAlert = useCallback((b, s, t) => {
    if (viewMode !== 'live') return;

    let alerts = [];
    if (b > 100 || b < 60) alerts.push(`Nhịp tim bất thường: ${b} BPM`);
    if (s < 95) alerts.push(`SpO₂ thấp: ${s}%`);
    if (t < 35) alerts.push(`Hạ nhiệt: ${t}°C`);
    if (t > 37) alerts.push(`Nhiệt độ cao: ${t}°C`);

    if (alerts.length > 0) {
      setAlertMessage(alerts.join(' | '));
      setShowAlert(true);
      // Tự động ẩn thông báo sau 5 giây
      setTimeout(() => setShowAlert(false), 5000);
    }
  }, [viewMode]);

  // Các hàm tính toán trạng thái
  const getBpmStatus = (b) => {
    if (isLoadingHistory) return { text: '...', className: 'status-warning' };
    if (b === 0) return { text: 'Đang chờ...', className: 'status-warning' };
    if (b < 60) return { text: 'Nhịp chậm (Bradycardia)', className: 'status-warning' };
    if (b <= 100) return { text: 'Bình thường', className: 'status-normal' };
    return { text: 'Nhịp nhanh (Tachycardia)', className: 'status-danger' };
  };
  const getSpo2Status = (v) => {
    if (isLoadingHistory) return { text: '...', className: 'status-warning' };
    if (v >= 95) return { text: 'Bình thường', className: 'status-normal' };
    if (v >= 90) return { text: 'Cần theo dõi', className: 'status-warning' };
    if (v > 0) return { text: 'Nguy hiểm', className: 'status-danger' };
    return { text: 'Đang chờ...', className: 'status-warning' };
  };
  const getTempStatus = (t) => {
    if (isLoadingHistory) return { text: '...', className: 'status-warning' };
    if (t < 35 && t > 0) return { text: 'Nhiệt độ thấp', className: 'status-danger' };
    if (t >= 35 && t <= 37) return { text: 'Bình thường', className: 'status-normal' };
    if (t > 37) return { text: 'Nhiệt độ cao', className: 'status-danger' };
    return { text: 'Đang chờ...', className: 'status-warning' };
  };

  const bpmStatus = getBpmStatus(bpm);
  const spo2Status = getSpo2Status(spo2);
  const tempStatus = getTempStatus(temperature);

  // === 13. GIAO DIỆN JSX ===
  // Gọi kiểm tra trạng thái khi các giá trị thay đổi
  useEffect(() => {
    checkAndShowAlert(bpm, spo2, temperature);
  }, [bpm, spo2, temperature, checkAndShowAlert]);

  // Choose chart data depending on mode to avoid mixing live placeholders with historical datasets
  const chartDataToRender = (viewMode === 'historical')
    ? createHistoricalChart(historicalReadings || [], activeChart)
    : (activeChart === 'bpm' ? bpmChartData : activeChart === 'spo2' ? spo2ChartData : tempChartData);

  return (
    <div className="dashboard-layout">
      <GlobalStyles />
      <div className="ekg-background-line" />
      {showAlert && <AlertBanner message={alertMessage} />}
      <Toast toast={toast} onClose={() => setToast(null)} />

      <div className="dashboard-container">
        {/* === CỘT CHÍNH === */}
        <main className="main-content">
          <header className="main-header-overview">
            <div className="header-flex-container">
              <div className="header-content">
                {/* School info */}
                <div className="school-info">
                  <img
                    src="/utc-logo.png"
                    alt="Logo Trường ĐH Giao thông vận tải"
                    className="school-logo"
                  />
                  <h2 className="school-name">Đại học Giao thông vận tải</h2>
                </div>

                {/* App title */}
                <div className="app-title-container">
                  {viewMode !== 'live' && (
                    <div className="overview-subtitle">
                      <div className="history-heading">
                        <span>DỮ LIỆU NGÀY: {selectedDate.toLocaleDateString('vi-VN')}</span>
                        {isSelectedFutureDate ? (
                          <span className="history-note history-note--future">CHƯA TỚI NGÀY ĐO!</span>
                        ) : hasHistoricalReadings ? (
                          <button
                            className="history-export-btn"
                            onClick={() => exportToCSV(historicalReadings, `BaoCao_SucKhoe_${selectedDate.toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`, patientName)}
                          >
                            📥 Xuất Excel
                          </button>
                        ) : (
                          <span className="history-note">Chưa có dữ liệu</span>
                        )}
                      </div>
                    </div>
                  )}
                  <h1 className="overview-title">Trung Tâm Giám Sát Sức Khỏe</h1>

                  {/* Patient Name Input với Start/Stop */}
                  <div className="patient-form">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1.1rem', color: 'var(--text-color-light)' }}>Bệnh nhân:</span>
                      <input
                        value={patientName}
                        onChange={(e) => setPatientName(e.target.value)}
                        onKeyPress={handlePatientNameKeyPress}
                        disabled={isMeasuring}
                        style={{
                          border: 'none',
                          borderBottom: isMeasuring ? '2px solid var(--color-bpm)' : '1px dashed #cbd5e0',
                          background: isMeasuring ? 'rgba(255, 77, 109, 0.05)' : 'transparent',
                          fontWeight: '600',
                          color: 'var(--text-color)',
                          fontSize: '1.1rem',
                          width: '210px',
                          outline: 'none',
                          fontFamily: 'inherit',
                          textAlign: 'center',
                          opacity: isMeasuring ? 0.8 : 1,
                          cursor: isMeasuring ? 'not-allowed' : 'text'
                        }}
                        title={isMeasuring ? "Đang đo - không thể sửa" : "Nhập tên bệnh nhân"}
                        placeholder="Nguyễn Văn A"
                      />
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1rem', color: 'var(--text-color-light)' }}>Giới tính:</span>
                      <select
                        value={patientGender}
                        onChange={(e) => setPatientGender(e.target.value)}
                        disabled={isMeasuring}
                        style={{
                          border: 'none',
                          borderBottom: isMeasuring ? '2px solid var(--color-bpm)' : '1px dashed #cbd5e0',
                          background: isMeasuring ? 'rgba(255, 77, 109, 0.05)' : 'transparent',
                          fontWeight: '600',
                          color: 'var(--text-color)',
                          fontSize: '1rem',
                          width: '90px',
                          outline: 'none',
                          fontFamily: 'inherit',
                          textAlign: 'center',
                          opacity: isMeasuring ? 0.8 : 1,
                          cursor: isMeasuring ? 'not-allowed' : 'pointer',
                          padding: '2px 5px'
                        }}
                        title={isMeasuring ? "Đang đo - không thể sửa" : "Chọn giới tính"}
                      >
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                        <option value="Khác">Khác</option>
                      </select>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '1rem', color: 'var(--text-color-light)' }}>Tuổi:</span>
                      <input
                        type="number"
                        value={patientAge}
                        onChange={(e) => setPatientAge(e.target.value)}
                        onKeyPress={handlePatientNameKeyPress}
                        disabled={isMeasuring}
                        min="0"
                        max="150"
                        style={{
                          border: 'none',
                          borderBottom: isMeasuring ? '2px solid var(--color-bpm)' : '1px dashed #cbd5e0',
                          background: isMeasuring ? 'rgba(255, 77, 109, 0.05)' : 'transparent',
                          fontWeight: '600',
                          color: 'var(--text-color)',
                          fontSize: '1rem',
                          width: '108px',
                          outline: 'none',
                          fontFamily: 'inherit',
                          textAlign: 'center',
                          opacity: isMeasuring ? 0.8 : 1,
                          cursor: isMeasuring ? 'not-allowed' : 'text'
                        }}
                        title={isMeasuring ? "Đang đo - không thể sửa" : "Chọn tuổi"}
                        placeholder="Chọn tuổi"
                      />
                    </div>
                    
                    {viewMode === 'live' && (
                      <>
                        <button
                          onClick={isMeasuring ? stopMeasurement : startMeasurement}
                          disabled={!isMeasuring && !canStartMeasurement}
                          title={canStartMeasurement || isMeasuring ? '' : 'Chưa nhận dữ liệu từ ESP32'}
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: 'white',
                            background: isMeasuring
                              ? 'linear-gradient(90deg, #dc3545, #c82333)'
                              : canStartMeasurement
                                ? 'linear-gradient(90deg, #28a745, #218838)'
                                : 'linear-gradient(90deg, #94a3b8, #64748b)',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: (!isMeasuring && !canStartMeasurement) ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                            transition: 'all 0.3s ease',
                            fontFamily: 'inherit',
                            opacity: (!isMeasuring && !canStartMeasurement) ? 0.72 : 1
                          }}
                          onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                          onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}
                        >
                          {isMeasuring ? '⏹️ Dừng đo' : '▶️ Bắt đầu đo'}
                        </button>
                        
                        <button
                          onClick={async () => {
                            setIsLoadingHistory(true);
                            const today = new Date();
                            const todayStr = getDocId(today);
                            
                            if (db && userId) {
                              const docPath = `artifacts/${appId}/users/${userId}/health_data/${todayStr}`;
                              const docRef = doc(db, docPath);
                              try {
                                const docSnap = await getDoc(docRef);
                                if (docSnap.exists()) {
                                  const data = docSnap.data();
                                  const records = data.records || [];
                                  if (records.length === 0) {
                                    showToast('Chưa có dữ liệu đo nào hôm nay! Hãy ấn "▶️ Bắt đầu đo" để bắt đầu.', 'info');
                                  } else {
                                    exportToCSV(records, `BaoCao_SucKhoe_${today.toLocaleDateString('vi-VN').replace(/\//g, '-')}.xlsx`, patientName);
                                  }
                                } else {
                                  showToast('Chưa có dữ liệu đo nào hôm nay! Hãy ấn "▶️ Bắt đầu đo" để bắt đầu.', 'info');
                                }
                              } catch (error) {
                                console.error('Lỗi khi tải dữ liệu:', error);
                                showToast('Lỗi khi tải dữ liệu: ' + error.message, 'error');
                              }
                            } else {
                              showToast('Đang kết nối Firebase, vui lòng đợi một chút!', 'info');
                            }
                            setIsLoadingHistory(false);
                          }}
                          style={{
                            padding: '0.5rem 1rem',
                            fontSize: '0.9rem',
                            fontWeight: '600',
                            color: 'white',
                            background: 'linear-gradient(90deg, #28a745, #218838)',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                            transition: 'all 0.3s ease',
                            fontFamily: 'inherit'
                          }}
                          onMouseOver={(e) => {
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
                          }}
                          onMouseOut={(e) => {
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
                          }}
                        >
                          📥 Xuất Excel hôm nay
                        </button>
                      </>
                    )}
                  </div>
                  
                  {/* Thời gian đo */}
                  {(isMeasuring || isMeasuringBpm || isMeasuringSpo2 || isMeasuringTemp) && measurementStartTime && (() => {
                    // Xác định các chỉ số đang đo
                    const measuring = [];
                    if (isMeasuring) {
                      measuring.push('Tất cả');
                    } else {
                      if (isMeasuringBpm) measuring.push('💓 BPM');
                      if (isMeasuringSpo2) measuring.push('🫁 SpO2');
                      if (isMeasuringTemp) measuring.push('🌡️ Nhiệt độ');
                    }
                    
                    return (
                      <div style={{ 
                        marginTop: '0.5rem', 
                        fontSize: '0.85rem', 
                        color: isMeasuring ? 'var(--color-bpm)' : (isMeasuringTemp ? '#ffa500' : isMeasuringSpo2 ? '#00b4d8' : '#ff4d6d'),
                        fontWeight: '500',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px'
                      }}>
                        🔴 Đang đo: {measuring.join(' + ')} · Bắt đầu: {measurementStartTime.toLocaleTimeString('vi-VN')}
                      </div>
                    );
                  })()}
                </div>
              </div>

              <div className="heart-rate-container">
                <HeartRateCircle bpm={bpm} />
              </div>
            </div>
          </header>

          <div className="metrics-grid">
            {/* (🎨 ĐÃ SỬA: Thêm onClick và className) */}
            <div
              className={`metric-card glass-card ${bpmStatus.className} ${activeChart === 'bpm' ? 'active-chart' : ''}`}
              onClick={() => handleChartSelect('bpm')}
            >
              <div className="card-header">
                <div className="header-text">
                  <h2>Nhịp tim (BPM)</h2>
                  <span className="sensor-name">(MAX30102)</span>
                </div>
                <div className="metric-icon"><HeartIcon /></div>
              </div>
              <div className="card-body">
                {isLoadingHistory ? (
                  <span className="metric-value metric-value--loading">⋯</span>
                ) : bpm > 0 ? (
                  <span className="metric-value">{bpmDisplay.toFixed(0)}</span>
                ) : (
                  <div className="metric-empty">
                    <span className="metric-empty__icon" aria-hidden="true">👆</span>
                    <span className="metric-empty__text">Đặt ngón tay<br/>lên cảm biến</span>
                  </div>
                )}
              </div>
              <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="status-indicator">{bpmStatus.text}</span>
                {viewMode === 'live' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isMeasuringBpm ? stopMeasuringBpm() : startMeasuringBpm();
                    }}
                    disabled={!isMeasuringBpm && !canStartMeasurement}
                    title={canStartMeasurement || isMeasuringBpm ? '' : 'Chưa nhận dữ liệu từ ESP32'}
                    style={{
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      color: 'white',
                      background: isMeasuringBpm
                        ? 'linear-gradient(90deg, #dc3545, #c82333)'
                        : canStartMeasurement
                          ? 'linear-gradient(90deg, #ff4d6d, #ff3355)'
                          : 'linear-gradient(90deg, #94a3b8, #64748b)',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: (!isMeasuringBpm && !canStartMeasurement) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                      transition: 'all 0.2s ease',
                      fontFamily: 'inherit',
                      opacity: (!isMeasuringBpm && !canStartMeasurement) ? 0.72 : 1
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {isMeasuringBpm ? '⏹️ Dừng' : '▶️ Đo'}
                  </button>
                )}
              </div>
            </div>

            {/* (🎨 ĐÃ SỬA: Thêm onClick và className) */}
            <div
              className={`metric-card glass-card ${spo2Status.className} ${activeChart === 'spo2' ? 'active-chart' : ''}`}
              onClick={() => handleChartSelect('spo2')}
            >
              <div className="card-header">
                <div className="header-text">
                  <h2>Nồng độ Oxy (SpO₂)</h2>
                  <span className="sensor-name">(MAX30102)</span>
                </div>
                <div className="metric-icon"><LungsIcon /></div>
              </div>
              <div className="card-body">
                {isLoadingHistory ? (
                  <span className="metric-value metric-value--loading">⋯</span>
                ) : spo2 > 0 ? (
                  <>
                    <span className="metric-value">{spo2Display.toFixed(1)}</span>
                    <span className="unit">%</span>
                  </>
                ) : (
                  <div className="metric-empty">
                    <span className="metric-empty__icon" aria-hidden="true">👆</span>
                    <span className="metric-empty__text">Đặt ngón tay<br/>lên cảm biến</span>
                  </div>
                )}
              </div>
              <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="status-indicator">{spo2Status.text}</span>
                {viewMode === 'live' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isMeasuringSpo2 ? stopMeasuringSpo2() : startMeasuringSpo2();
                    }}
                    disabled={!isMeasuringSpo2 && !canStartMeasurement}
                    title={canStartMeasurement || isMeasuringSpo2 ? '' : 'Chưa nhận dữ liệu từ ESP32'}
                    style={{
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      color: 'white',
                      background: isMeasuringSpo2
                        ? 'linear-gradient(90deg, #dc3545, #c82333)'
                        : canStartMeasurement
                          ? 'linear-gradient(90deg, #00b4d8, #0096c7)'
                          : 'linear-gradient(90deg, #94a3b8, #64748b)',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: (!isMeasuringSpo2 && !canStartMeasurement) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                      transition: 'all 0.2s ease',
                      fontFamily: 'inherit',
                      opacity: (!isMeasuringSpo2 && !canStartMeasurement) ? 0.72 : 1
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {isMeasuringSpo2 ? '⏹️ Dừng' : '▶️ Đo'}
                  </button>
                )}
              </div>
            </div>

            {/* (🎨 ĐÃ SỬA: Thêm onClick và className) */}
            <div
              className={`metric-card glass-card ${tempStatus.className} ${activeChart === 'temp' ? 'active-chart' : ''}`}
              onClick={() => handleChartSelect('temp')}
            >
              <div className="card-header">
                <div className="header-text">
                  <h2>Nhiệt độ cơ thể (°C)</h2>
                  <span className="sensor-name">(DS18B20)</span>
                </div>
                <div className="metric-icon"><TempIcon /></div>
              </div>
              <div className="card-body">
                {isLoadingHistory ? (
                  <span className="metric-value metric-value--loading">⋯</span>
                ) : temperature > 0 ? (
                  <>
                    <span className="metric-value">{tempDisplay.toFixed(1)}</span>
                    <span className="unit">°C</span>
                  </>
                ) : (
                  <div className="metric-empty">
                    <span className="metric-empty__icon" aria-hidden="true">🌡️</span>
                    <span className="metric-empty__text">Áp cảm biến<br/>vào da</span>
                  </div>
                )}
              </div>
              <div className="card-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="status-indicator">{tempStatus.text}</span>
                {viewMode === 'live' && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      isMeasuringTemp ? stopMeasuringTemp() : startMeasuringTemp();
                    }}
                    disabled={!isMeasuringTemp && !canStartMeasurement}
                    title={canStartMeasurement || isMeasuringTemp ? '' : 'Chưa nhận dữ liệu từ ESP32'}
                    style={{
                      padding: '0.4rem 0.8rem',
                      fontSize: '0.8rem',
                      fontWeight: '600',
                      color: 'white',
                      background: isMeasuringTemp
                        ? 'linear-gradient(90deg, #dc3545, #c82333)'
                        : canStartMeasurement
                          ? 'linear-gradient(90deg, #ffa500, #ff8c00)'
                          : 'linear-gradient(90deg, #94a3b8, #64748b)',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: (!isMeasuringTemp && !canStartMeasurement) ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                      transition: 'all 0.2s ease',
                      fontFamily: 'inherit',
                      opacity: (!isMeasuringTemp && !canStartMeasurement) ? 0.72 : 1
                    }}
                    onMouseOver={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                    onMouseOut={(e) => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    {isMeasuringTemp ? '⏹️ Dừng' : '▶️ Đo'}
                  </button>
                )}
              </div>
            </div>
          </div>

          <section className="chart-section glass-card">
            {isLoadingHistory && <div className="loading-overlay">Đang tải...</div>}
            {/* (🎨 ĐÃ SỬA: Truyền per-chart data theo activeChart) */}
            <Line
              key={`${viewMode}-${activeChart}`}
              data={chartDataToRender}
              options={createChartOptions(isLoadingHistory, viewMode, activeChart)}
            />
          </section>
        </main>

        {/* === CỘT PHỤ (SIDEBAR) === */}
        <aside className="sidebar">
          <div className="connection-status-card glass-card">
            <h3 className="widget-title">Trạng thái hệ thống</h3>
            <div className={`status-bubble ${connectionStatus.includes('Đã') ? 'status-normal' : 'status-danger'}`}>
              {connectionStatus}
            </div>
            
            {/* Save Status Indicator */}
            {viewMode === 'live' && isCanvasEnvironment && db && (
              <div className={`save-status-indicator ${saveStatus}`} style={{ marginTop: '12px' }}>
                <span className={`save-icon ${saveStatus === 'saving' ? 'saving' : ''}`}>
                  {!isMeasuring && '⏸️'}
                  {isMeasuring && saveStatus === 'waiting' && '⏳'}
                  {isMeasuring && saveStatus === 'saving' && '🔄'}
                  {isMeasuring && saveStatus === 'saved' && '✅'}
                  {saveStatus === 'error' && '❌'}
                </span>
                <div className="save-details">
                  <div>
                    {!isMeasuring && 'Chưa đo'}
                    {isMeasuring && saveStatus === 'waiting' && 'Đang đo...'}
                    {isMeasuring && saveStatus === 'saving' && 'Đang lưu vào Firebase...'}
                    {isMeasuring && saveStatus === 'saved' && '✓ Đã lưu thành công'}
                    {saveStatus === 'error' && 'Lỗi khi lưu'}
                  </div>
                  {lastSavedTime && saveStatus !== 'saving' && isMeasuring && (
                    <div className="save-time">
                      Lần cuối: {lastSavedTime.toLocaleTimeString('vi-VN')}
                    </div>
                  )}
                  {recordsSavedToday > 0 && isMeasuring && (
                    <div className="save-time">
                      {recordsSavedToday} bản ghi phiên này
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Thẻ thông tin sinh viên - Đưa lên trên */}
          <div className="student-info-card glass-card">
            <h3 className="widget-title">Sinh viên thực hiện</h3>
            <div className="student-info">
              <div className="student-avatar-wrap">
                <img src="/CAY.PNG" alt="Đặng Văn Cấy" className="student-avatar" />
              </div>
              <div className="student-details">
                <h4>Đặng Văn Cấy</h4>
                <span className="student-id">MSV: 211411929</span>
                <span className="student-school">Lớp: Kỹ sư KTDT&amp;THCN1_K62</span>
              </div>
            </div>
          </div>

          {/* Calendar Card - Chuyển xuống dưới */}
          <div className="calendar-card glass-card">
            <h3 className="widget-title">Lịch theo dõi sức khỏe</h3>
            <Calendar
              selectedDate={selectedDate}
              onDateSelect={handleDateSelect}
            />
          </div>

        </aside>
      </div>
    </div>
  );
}

export default App;

