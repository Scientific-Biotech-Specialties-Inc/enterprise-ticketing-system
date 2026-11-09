import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import sbsiLogo from '@/assets/SBSI.png';
import heroBg from '@/assets/SBSI-bg.png';
import customerSystemUi from '@/assets/customer-system-ui.png';

/* ── Inline SVG Icon Components (matching lucide style) ── */
const ArrowRightIcon = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
);
const CheckCircleIcon = ({ size = 15, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/></svg>
);
const TicketIcon = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg>
);
const LockIcon = ({ size = 10 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
);
const SparklesIcon = ({ size = 12, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>
);
const ShieldCheckIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>
);
const ClockIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
);
const HeadphonesIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/></svg>
);
const BarChartIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/></svg>
);
const MessageSquareIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
);
const ZapIcon = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
);

/* ══════════════════════════════════════════════════════════════════════
   STYLES — ONE UI DESIGN SYSTEM ENFORCEMENT
   Brand Primary: #252578 | Brand Accent: #2E85D8 | Brand Deep: #3A3A85
   Brand Deep Border: #4E4E91 | Dark Slate: #1E293B | Muted Slate: #8D8B8F
   ══════════════════════════════════════════════════════════════════════ */
const styles = `
/* Reset */
.lp-container * { box-sizing: border-box; margin: 0; padding: 0; }

.lp-container {
  font-family: 'Poppins', 'Montserrat', -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: #f8f9fa;
  color: #1e293b;
  min-height: 100vh;
  overflow-x: hidden;
  scroll-behavior: smooth;
}

.lp-section-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 24px;
}

/* ── NAVIGATION BAR ── */
.lp-nav {
  position: fixed;
  top: 0; left: 0;
  width: 100%;
  height: 64px;
  z-index: 1000;
  background-color: rgba(37, 37, 120, 0.95);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255,255,255,0.12);
}
.lp-nav-inner {
  max-width: 1400px;
  height: 100%;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.lp-nav-logo { display: flex; align-items: center; text-decoration: none; cursor: pointer; }
.lp-logo-img { height: 42px; object-fit: contain; transition: transform 0.2s ease; }
.lp-logo-img:hover { transform: scale(1.03); }

.lp-nav-right { display: flex; align-items: center; gap: 16px; }
.lp-nav-links { display: flex; align-items: center; gap: 6px; }
.lp-nav-link {
  color: rgba(255,255,255,0.75);
  font-size: 13.5px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.2s ease;
  background: none;
}
.lp-nav-link:hover { color: #fff; background: rgba(255,255,255,0.12); }
.lp-nav-link.is-active {
  color: #fff;
  background-color: #3a3a85;
  border-color: #4e4e91;
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}
.lp-nav-divider { width: 1px; height: 24px; background-color: rgba(255,255,255,0.18); }
.lp-btn-login {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: #2e85d8;
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  padding: 8px 22px;
  border-radius: 8px;
  text-decoration: none;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  border: none;
  cursor: pointer;
}
.lp-btn-login:hover {
  background-color: #1e1e66;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(46,133,216,0.35);
}

/* ── SECTION 1: HERO ── */
.lp-hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding-top: 64px;
}
.lp-hero-bg {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  z-index: 1;
}
.lp-hero-overlay {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(37,37,120,0.52) 0%, rgba(25,25,85,0.42) 45%, rgba(14,14,46,0.68) 100%);
  z-index: 2;
}
.lp-hero-content {
  position: relative;
  z-index: 3;
  max-width: 1000px;
  margin: 0 auto;
  padding: 80px 24px 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}
.lp-hero-title {
  color: #fff;
  font-size: clamp(34px, 5.5vw, 64px);
  font-weight: 800;
  line-height: 1.18;
  letter-spacing: -0.02em;
  margin-bottom: 20px;
  text-shadow: 0 3px 12px rgba(0,0,0,0.5);
}
.lp-hero-divider {
  width: 180px; height: 4px;
  background-color: #2e85d8;
  border-radius: 2px;
  margin-bottom: 24px;
  box-shadow: 0 2px 8px rgba(46,133,216,0.6);
}
.lp-hero-desc {
  color: rgba(255,255,255,0.95);
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.7;
  max-width: 680px;
  margin-bottom: 36px;
  font-weight: 400;
  text-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.lp-cta-primary {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 14px 40px;
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  background-color: #2e85d8;
  border-radius: 9999px;
  text-decoration: none;
  box-shadow: 0 4px 16px rgba(46,133,216,0.5);
  transition: all 0.25s ease;
  border: none;
  cursor: pointer;
}
.lp-cta-primary:hover {
  background-color: #252578;
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(37,37,120,0.5);
}

/* ── SHARED SECTION HEADERS ── */
.lp-section-head { margin-bottom: 32px; }
.lp-eyebrow {
  display: inline-block;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #2e85d8;
  margin-bottom: 8px;
}
.lp-section-title {
  font-size: clamp(26px, 3.5vw, 36px);
  font-weight: 800;
  color: #1e293b;
  letter-spacing: -0.02em;
  line-height: 1.25;
  margin-bottom: 10px;
}
.lp-section-subtitle {
  color: #8d8b8f;
  font-size: 15px;
  max-width: 680px;
  line-height: 1.6;
}
.text-center .lp-section-subtitle { margin: 0 auto; }

/* ── SECTION 2: TICKETING SYSTEM SHOWCASE ── */
.lp-slides-section {
  padding: 96px 0;
  background: #fff;
  border-bottom: 1px solid #e2e8f0;
}
.lp-carousel-card {
  position: relative;
  max-width: 1160px;
  margin: 0 auto;
  background: #f8f9fa;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  padding: 32px 36px;
  box-shadow: 0 4px 20px -2px rgba(0,0,0,0.05);
  overflow: hidden;
}
.lp-slide-content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 32px;
  align-items: center;
}
.lp-slide-text { display: flex; flex-direction: column; }
.lp-slide-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 700;
  margin-bottom: 10px;
}
.lp-pill-dot { width: 5px; height: 5px; border-radius: 50%; }
.lp-slide-name {
  font-size: clamp(20px, 2.2vw, 24px);
  font-weight: 800;
  color: #1e293b;
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}
.lp-slide-tagline { font-size: 13px; font-weight: 600; color: #475569; margin-bottom: 8px; }
.lp-slide-desc { font-size: 12.5px; color: #64748b; line-height: 1.55; margin-bottom: 14px; }
.lp-capabilities-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 14px;
}
.lp-capability-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #334155;
}
.lp-slide-metrics {
  display: flex;
  gap: 18px;
  padding: 8px 0;
  margin-bottom: 16px;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
}
.lp-metric-box { display: flex; flex-direction: column; }
.lp-metric-val { font-size: 18px; font-weight: 800; color: #1e293b; }
.lp-metric-lbl { font-size: 10px; color: #8d8b8f; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; }
.lp-slide-action { display: flex; align-items: center; gap: 12px; }
.lp-slide-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 18px;
  border-radius: 7px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  box-shadow: 0 2px 6px rgba(0,0,0,0.12);
  transition: all 0.2s ease;
  border: none;
  cursor: pointer;
}
.lp-slide-btn:hover { transform: translateY(-1px); filter: brightness(1.1); }
.lp-sso-note { font-size: 11px; color: #8d8b8f; font-weight: 500; }

/* Mock Window */
.lp-slide-visual { display: flex; justify-content: center; }
.lp-mock-window {
  position: relative;
  width: 100%;
  max-width: 500px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 16px 36px -8px rgba(0,0,0,0.12);
  overflow: hidden;
}
.lp-mock-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  background: #f8fafc;
  border-bottom: 1px solid #e2e8f0;
}
.lp-mock-dots { display: flex; gap: 4px; }
.lp-mock-dot { width: 8px; height: 8px; border-radius: 50%; }
.lp-mock-dot.red { background: #ef4444; }
.lp-mock-dot.yellow { background: #f59e0b; }
.lp-mock-dot.green { background: #10b981; }
.lp-mock-address {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: #64748b;
  background: #fff;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.lp-mock-badge {
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}
.lp-mock-canvas { padding: 12px; }
.lp-mock-stats-row { display: flex; gap: 8px; margin-bottom: 8px; }
.lp-mock-stat-chip {
  flex: 1;
  background: #f8fafc;
  border: 1px solid #f1f5f9;
  border-radius: 6px;
  padding: 4px 8px;
  display: flex;
  flex-direction: column;
}
.lp-m-chip-lbl { font-size: 8.5px; color: #8d8b8f; text-transform: uppercase; font-weight: 600; }
.lp-m-chip-val { font-size: 11px; font-weight: 700; }
.lp-mock-chart-container {
  background: #fff;
  border: 1px solid #f1f5f9;
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
}
.lp-mock-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.lp-mock-chart-title { font-size: 10.5px; font-weight: 700; color: #1e293b; }
.lp-mock-chart-trend { font-size: 9.5px; font-weight: 600; }
.lp-mock-chart-svg { width: 100%; height: 65px; }
.lp-mock-feed { display: flex; flex-direction: column; gap: 4px; }
.lp-mock-feed-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
  background: #f8fafc;
  border-radius: 4px;
  font-size: 9.5px;
}
.lp-mock-feed-left {
  display: flex;
  align-items: center;
  gap: 5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lp-mock-feed-dot { width: 4px; height: 4px; border-radius: 50%; flex-shrink: 0; }
.lp-mock-feed-title { color: #334155; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lp-mock-feed-status {
  padding: 1px 6px;
  border-radius: 9999px;
  font-size: 9px;
  font-weight: 700;
  flex-shrink: 0;
}
.status-approved { background: #ecfdf5; color: #10b981; }
.status-pending { background: #fffbeb; color: #f59e0b; }
.lp-mock-lens-badge {
  position: absolute;
  bottom: 8px; right: 8px;
  background: rgba(255,255,255,0.96);
  backdrop-filter: blur(8px);
  border: 1px solid;
  border-radius: 9999px;
  padding: 3px 8px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 9px;
  font-weight: 700;
  color: #1e293b;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
}

/* ── SECTION 3: FEATURES CARDS ── */
.lp-cards-section {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 96px 0;
  background: #f8f9fa;
  position: relative;
}
.lp-system-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 28px;
  margin-top: 32px;
}
.lp-sys-card {
  position: relative;
  background: #fff;
  border: 1.5px solid #e2e8f0;
  border-radius: 20px;
  padding: 36px 30px;
  min-height: 280px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 18px;
  overflow: hidden;
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow: 0 4px 16px rgba(0,0,0,0.04);
}
.lp-sys-ambient-blob {
  position: absolute;
  top: -20px; right: -20px;
  width: 80px; height: 80px;
  border-radius: 50%;
  background: var(--card-glow);
  filter: blur(24px);
  pointer-events: none;
  z-index: 0;
  transition: transform 0.4s ease;
}
.lp-sys-card:hover {
  transform: translateY(-8px);
  border-color: var(--bottom-accent);
  box-shadow: 0 16px 32px -6px rgba(0,0,0,0.1);
}
.lp-sys-card:hover .lp-sys-ambient-blob { transform: scale(2.4); }
.lp-sys-icon-box {
  position: relative;
  z-index: 1;
  width: 52px; height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.05);
}
.lp-sys-body {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}
.lp-sys-title { font-size: 17px; font-weight: 700; color: #1e293b; line-height: 1.3; }
.lp-sys-desc { font-size: 13px; color: #64748b; line-height: 1.6; }
.lp-sys-action-link {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  padding: 7px 14px;
  border-radius: 8px;
  border: 1px solid currentColor;
  background: rgba(255,255,255,0.85);
  margin-top: auto;
  transition: all 0.2s ease;
  cursor: pointer;
}
.lp-sys-action-link:hover {
  background-color: var(--bottom-accent);
  color: #fff !important;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
  transform: translateY(-1px);
}
.lp-sys-bottom-accent {
  position: absolute;
  bottom: 0; left: 0;
  width: 100%; height: 5px;
  background-color: var(--bottom-accent);
}

/* ── FOOTER ── */
.lp-footer {
  background-color: #101036;
  border-top: 3px solid #2e85d8;
  color: #fff;
  padding: 64px 0 32px;
}
.lp-footer-container {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0 24px;
}
.lp-footer-grid {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr 1.1fr;
  gap: 40px;
  margin-bottom: 48px;
}
.lp-footer-brand-col { display: flex; flex-direction: column; gap: 16px; }
.lp-footer-logo-link { display: inline-block; text-decoration: none; cursor: pointer; }
.lp-footer-logo { height: 56px; object-fit: contain; transition: opacity 0.2s ease; }
.lp-footer-logo:hover { opacity: 0.9; }
.lp-footer-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 9999px;
  font-size: 11.5px;
  font-weight: 600;
  color: #fff;
  width: fit-content;
  backdrop-filter: blur(8px);
}
.lp-footer-badge-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background-color: #10b981;
  box-shadow: 0 0 8px #10b981;
}
.lp-footer-col { display: flex; flex-direction: column; }
.lp-footer-col-title {
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #fff;
  margin-bottom: 20px;
}
.lp-footer-list {
  list-style: none;
  padding: 0; margin: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.lp-footer-link-item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #a7a7c8;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
}
.lp-footer-link-item:hover { color: #fff; transform: translateX(3px); }
.lp-footer-link-accent { color: #2e85d8; font-weight: 600; }
.lp-footer-link-accent:hover { color: #60a5fa; }
.lp-footer-security-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #a7a7c8;
}
.lp-footer-sec-icon { color: #10b981; flex-shrink: 0; }
.lp-footer-bottom {
  border-top: 1px solid rgba(255,255,255,0.09);
  padding-top: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  font-size: 12px;
  color: rgba(167,167,200,0.7);
}
.lp-footer-copy { font-weight: 400; text-align: center; width: 100%; }

/* ── ANIMATIONS ── */
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
.lp-hero-content > * { animation: fadeInUp 0.8s ease-out forwards; }
.lp-hero-title { animation-delay: 0.1s; }
.lp-hero-divider { animation-delay: 0.3s; }
.lp-hero-desc { animation-delay: 0.5s; }
.lp-hero-ctas { animation-delay: 0.7s; }

/* ── RESPONSIVE ── */
@media (max-width: 1200px) {
  .lp-system-cards-grid { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 900px) {
  .lp-slide-content { grid-template-columns: 1fr; gap: 24px; }
  .lp-system-cards-grid { grid-template-columns: repeat(2, 1fr); }
  .lp-footer-grid { grid-template-columns: repeat(2, 1fr); gap: 32px; }
  .lp-nav-links { gap: 4px; }
  .lp-nav-link { padding: 5px 10px; font-size: 12.5px; }
}
@media (max-width: 640px) {
  .lp-nav-links { display: none; }
  .lp-nav-divider { display: none; }
  .lp-slides-section { padding: 56px 0; }
  .lp-cards-section { min-height: auto; padding: 56px 0; }
  .lp-carousel-card { padding: 24px 18px; }
  .lp-capabilities-grid { grid-template-columns: 1fr; }
  .lp-system-cards-grid { grid-template-columns: 1fr; }
  .lp-footer-grid { grid-template-columns: 1fr; gap: 28px; }
  .lp-footer-bottom { flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 12px; }
}
`;

/* ═════════════════════════════════════════════════════════════════════
   TICKETING SYSTEM DATA
   ═════════════════════════════════════════════════════════════════════ */
const ticketingSystem = {
  id: 'ts',
  slug: 'ts',
  title: 'Customer Support Portal',
  shortTitle: 'Customer Care',
  fullName: 'Enterprise Customer Support Portal',
  acronym: 'TS',
  category: '24/7 Equipment & Diagnostic Support',
  accentColor: '#F59E0B',
  lightBg: '#FFFBEB',
  tagline: 'Fast, Transparent Care for Your Laboratory & Diagnostic Equipment',
  detailedDesc:
    'Keep your laboratory and diagnostic operations running without interruption. Easily request equipment maintenance, get instant troubleshooting answers, and stay connected with certified specialists until your issue is resolved.',
  keyFeatures: [
    'Effortless Online Service Requests',
    'Live Repair & Resolution Updates',
    '24/7 Instant AI Troubleshooting',
    'Direct Chat with Certified Specialists',
  ],
  metrics: [
    { val: '18 mins', lbl: 'Avg First Response' },
    { val: '99.4%', lbl: 'On-Time Resolution' },
    { val: '4.9 / 5', lbl: 'Customer Satisfaction' },
  ],
  badgeText: 'Customer Portal',
  chartTitle: 'Equipment Uptime & Fast Resolution Delivery',
  chartPathFill: 'M 0 115 L 0 70 Q 95 50 190 40 T 380 25 L 380 120 L 0 120 Z',
  chartPathStroke: 'M 0 70 Q 95 50 190 40 T 380 25',
  recentItems: [
    { title: 'Reagent Analyzer Firmware Calibration #TS-892', status: 'Resolved', statusClass: 'status-approved' },
    { title: 'Centrifuge Preventive Maintenance Check #TS-893', status: 'In Progress', statusClass: 'status-pending' },
    { title: 'Laboratory Network Interface Diagnostic', status: 'Resolved', statusClass: 'status-approved' },
  ],
};

/* Feature cards for Section 3 — customer benefit focused */
const featureCards = [
  {
    id: 'ticket-mgmt',
    title: 'Effortless Service Requests',
    desc: 'Report equipment concerns or request preventive maintenance in seconds, save drafts at your convenience, and get back to your work without hassle.',
    icon: TicketIcon,
    accentColor: '#F59E0B',
    lightBg: '#FFFBEB',
    shortTitle: 'Requests',
  },
  {
    id: 'support-channels',
    title: '24/7 Instant AI Guidance',
    desc: 'Get immediate, step-by-step troubleshooting assistance anytime day or night to resolve common equipment questions without waiting in line.',
    icon: HeadphonesIcon,
    accentColor: '#2E85D8',
    lightBg: '#EFF6FF',
    shortTitle: 'Assistance',
  },
  {
    id: 'communication',
    title: 'Direct Specialist Access',
    desc: 'Message your assigned field engineer and customer care team directly, share photos or reports, and keep all your answers in one place.',
    icon: MessageSquareIcon,
    accentColor: '#10B981',
    lightBg: '#ECFDF5',
    shortTitle: 'Connection',
  },
];

/* ═════════════════════════════════════════════════════════════════════
   COMPONENT
   ═════════════════════════════════════════════════════════════════════ */
export default function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuth();
  const [activeSection, setActiveSection] = useState('hero');

  /* Redirect authenticated customers immediately and lock Back/Forward history when logged out */
  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/customer-dashboard', { replace: true });
      return undefined;
    }

    // Truncate forward history (disables Forward button after logout) and block Back/Forward into dashboard
    // Capture this page's URL now: inside popstate, window.location already points at the entry
    // the user went back to, so re-pushing it would send them (and Forward) to the wrong page.
    const guardUrl = window.location.href;
    const guardState = window.history.state;
    window.history.pushState(guardState, '', guardUrl);
    const handlePopState = (e) => {
      e.stopImmediatePropagation();
      window.history.pushState(guardState, '', guardUrl);
    };
    window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('popstate', handlePopState, true);
    };
  }, [isLoading, isAuthenticated, navigate]);

  /* Inject scoped styles */
  useEffect(() => {
    const tag = document.createElement('style');
    tag.textContent = styles;
    document.head.appendChild(tag);
    return () => tag.remove();
  }, []);

  /* Intersection Observer for active nav highlight */
  useEffect(() => {
    const sections = ['hero', 'systems', 'features'];
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        });
      },
      { root: null, rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    );
    sections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const scrollTo = (sectionId) => {
    setActiveSection(sectionId);
    const el = document.getElementById(sectionId);
    if (el) el.scrollIntoView({ behavior: 'smooth' });
  };

  const ts = ticketingSystem;

  return (
    <div className="lp-container">
      {/* ── TOP NAVIGATION BAR ── */}
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <button className="lp-nav-logo" onClick={() => scrollTo('hero')} aria-label="SBSI Home">
            <img src={sbsiLogo} alt="Scientific Biotech Specialties, Inc." className="lp-logo-img" />
          </button>
          <div className="lp-nav-right">
            <nav className="lp-nav-links" aria-label="Main Navigation">
              <button className={`lp-nav-link${activeSection === 'hero' ? ' is-active' : ''}`} onClick={() => scrollTo('hero')}>Home</button>
              <button className={`lp-nav-link${activeSection === 'systems' ? ' is-active' : ''}`} onClick={() => scrollTo('systems')}>System</button>
              <button className={`lp-nav-link${activeSection === 'features' ? ' is-active' : ''}`} onClick={() => scrollTo('features')}>Features</button>
            </nav>
            <div className="lp-nav-divider" />
            <button className="lp-btn-login" onClick={() => navigate('/customer', { replace: true })}>Log in</button>
          </div>
        </div>
      </header>

      {/* ── SECTION 1: HERO ── */}
      <section id="hero" className="lp-hero">
        <div className="lp-hero-bg" style={{ backgroundImage: `url(${heroBg})` }} />
        <div className="lp-hero-overlay" />
        <div className="lp-hero-content">
          <h1 className="lp-hero-title">25 Years of Innovating Diagnostics Solutions</h1>
          <div className="lp-hero-divider" />
          <p className="lp-hero-desc">
            A unified platform for managing contracts, expenses, productivity and support — built for the business finance and marketing industry.
          </p>
          <div className="lp-hero-ctas">
            <button className="lp-cta-primary" onClick={() => navigate('/customer', { replace: true })}>
              <span>Get Started</span>
              <ArrowRightIcon size={18} />
            </button>
          </div>
        </div>
      </section>

      {/* ── SECTION 2: TICKETING SYSTEM SHOWCASE ── */}
      <section id="systems" className="lp-slides-section">
        <div className="lp-section-container">
          <div className="lp-section-head">
            <span className="lp-eyebrow">Dedicated Customer Care</span>
            <h2 className="lp-section-title">Dependable Support Built Around You</h2>
            <p className="lp-section-subtitle">
              Get fast, transparent support for your diagnostic equipment with instant AI guidance, direct specialist communication, and real-time resolution tracking.
            </p>
          </div>

          <div className="lp-carousel-card">
            <div className="lp-slide-content" style={{ '--slide-theme': ts.accentColor }}>
              {/* Left Column */}
              <div className="lp-slide-text">
                <h3 className="lp-slide-name">{ts.fullName}</h3>
                <p className="lp-slide-tagline">{ts.tagline}</p>
                <p className="lp-slide-desc">{ts.detailedDesc}</p>

                <div className="lp-capabilities-grid">
                  {ts.keyFeatures.map((feat, i) => (
                    <div key={i} className="lp-capability-item">
                      <CheckCircleIcon size={15} color={ts.accentColor} />
                      <span>{feat}</span>
                    </div>
                  ))}
                </div>

                <div className="lp-slide-metrics">
                  {ts.metrics.map((stat, i) => (
                    <div key={i} className="lp-metric-box">
                      <span className="lp-metric-val">{stat.val}</span>
                      <span className="lp-metric-lbl">{stat.lbl}</span>
                    </div>
                  ))}
                </div>

                <div className="lp-slide-action">
                  <button className="lp-slide-btn" style={{ backgroundColor: ts.accentColor }} onClick={() => navigate('/customer', { replace: true })}>
                    <span>Access {ts.acronym} Module</span>
                    <ArrowRightIcon size={15} />
                  </button>
                  <span className="lp-sso-note">SSO Authorized • RBAC Governed</span>
                </div>
              </div>

              {/* Right Column: Screenshot of Real Customer System UI */}
              <div className="lp-slide-visual">
                <div className="lp-mock-window">
                  <div className="lp-mock-topbar">
                    <div className="lp-mock-dots">
                      <span className="lp-mock-dot red" />
                      <span className="lp-mock-dot yellow" />
                      <span className="lp-mock-dot green" />
                    </div>
                    <div className="lp-mock-address">
                      <LockIcon size={10} />
                      <span>portal.sbsi.com.ph/customer-dashboard</span>
                    </div>
                    <div className="lp-mock-badge" style={{ backgroundColor: ts.lightBg, color: ts.accentColor }}>
                      {ts.badgeText}
                    </div>
                  </div>
                  <div className="relative overflow-hidden bg-slate-100 border-t border-slate-200">
                    <img
                      src={customerSystemUi}
                      alt="Customer Ticketing System Dashboard"
                      className="w-full h-auto block object-cover object-top hover:scale-[1.02] transition-transform duration-300"
                    />
                  </div>
                  <div className="lp-mock-lens-badge" style={{ borderColor: ts.accentColor }}>
                    <SparklesIcon size={12} color={ts.accentColor} />
                    <span>Real-Time One UI Customer Portal</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3: TICKETING FEATURES ── */}
      <section id="features" className="lp-cards-section">
        <div className="lp-section-container">
          <div className="lp-section-head text-center" style={{ textAlign: 'center' }}>
            <span className="lp-eyebrow">Customer Benefits</span>
            <h2 className="lp-section-title">Everything you need for uninterrupted operations</h2>
            <p className="lp-section-subtitle" style={{ margin: '0 auto' }}>
              Experience responsive, transparent equipment care designed to save you time and keep your laboratory running at its best.
            </p>
          </div>

          <div className="lp-system-cards-grid">
            {featureCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.id}
                  className="lp-sys-card"
                  style={{ '--bottom-accent': card.accentColor, '--card-glow': card.lightBg }}
                >
                  <div className="lp-sys-ambient-blob" />
                  <div className="lp-sys-icon-box" style={{ backgroundColor: card.lightBg, color: card.accentColor }}>
                    <Icon size={24} color={card.accentColor} />
                  </div>
                  <div className="lp-sys-body">
                    <h4 className="lp-sys-title">{card.title}</h4>
                    <p className="lp-sys-desc">{card.desc}</p>
                  </div>
                  <div className="lp-sys-bottom-accent" />
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-footer-container">
          <div className="lp-footer-grid">
            {/* Column 1: Brand */}
            <div className="lp-footer-brand-col">
              <button className="lp-footer-logo-link" onClick={() => scrollTo('hero')} aria-label="SBSI Home">
                <img src={sbsiLogo} alt="Scientific Biotech Specialties, Inc." className="lp-footer-logo" />
              </button>
              <div className="lp-footer-badge">
                <span className="lp-footer-badge-dot" />
                <span>ISO 9001:2015 Certified Enterprise</span>
              </div>
            </div>

            {/* Column 2: Ticketing System */}
            <div className="lp-footer-col">
              <h4 className="lp-footer-col-title">Ticketing System</h4>
              <ul className="lp-footer-list">
                <li><button className="lp-footer-link-item" onClick={() => navigate('/customer', { replace: true })}>Submit a Ticket</button></li>
                <li><button className="lp-footer-link-item" onClick={() => navigate('/customer', { replace: true })}>Track My Tickets</button></li>
                <li><button className="lp-footer-link-item" onClick={() => navigate('/customer', { replace: true })}>SLA Dashboard</button></li>
                <li><button className="lp-footer-link-item" onClick={() => navigate('/customer', { replace: true })}>Knowledge Base</button></li>
              </ul>
            </div>

            {/* Column 3: Navigation */}
            <div className="lp-footer-col">
              <h4 className="lp-footer-col-title">Navigation</h4>
              <ul className="lp-footer-list">
                <li><button className="lp-footer-link-item" onClick={() => scrollTo('hero')}>Home Overview</button></li>
                <li><button className="lp-footer-link-item" onClick={() => scrollTo('systems')}>Ticketing System</button></li>
                <li><button className="lp-footer-link-item" onClick={() => scrollTo('features')}>Platform Features</button></li>
                <li><button className="lp-footer-link-item lp-footer-link-accent" onClick={() => navigate('/customer', { replace: true })}>Access Portal</button></li>
              </ul>
            </div>

            {/* Column 4: Security */}
            <div className="lp-footer-col">
              <h4 className="lp-footer-col-title">Security & Authority</h4>
              <ul className="lp-footer-list">
                <li className="lp-footer-security-item">
                  <ShieldCheckIcon size={16} />
                  <span>OAuth2 / OpenID Connect SSO</span>
                </li>
                <li className="lp-footer-security-item">
                  <span className="lp-footer-sec-icon"><LockIcon size={16} /></span>
                  <span>Role-Based Access Control (RBAC)</span>
                </li>
                <li className="lp-footer-security-item">
                  <CheckCircleIcon size={16} color="#10b981" />
                  <span>Comprehensive Audit Trail</span>
                </li>
              </ul>
            </div>
          </div>

          <div className="lp-footer-bottom">
            <span className="lp-footer-copy">
              © 2026 Scientific Biotech Specialties, Inc. (SBSI). All rights reserved.
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
