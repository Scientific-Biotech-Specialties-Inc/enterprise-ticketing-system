import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, LogOut, ChevronDown, ChevronUp } from 'lucide-react';
import sbsiLogo from '@/assets/SBSI1.png';
import useLockBodyScroll from '@/hooks/useLockBodyScroll';
import { useAuth } from '@/context/AuthContext';
import { ConfirmationModal } from '@/components/ui/confirmation-modal';

function NavList({ items, collapsed, expanded }) {
  const location = useLocation();
  const showLabel = expanded;
  const hasActiveChild = (children) => children?.some((child) => location.pathname === child.path);

  return items.map((item) => {
    if (item.children) {
      const active = hasActiveChild(item.children);
      return (
        <div key={item.name} className="w-full">
          <div
            className={`flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all duration-200 min-h-[44px] ${
              active
                ? 'bg-[#3A3A85] border border-[#4E4E91] text-white font-bold'
                : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{item.icon}</span>
            <span
              className={`font-semibold text-sm whitespace-nowrap transition-opacity duration-200 ${
                showLabel ? 'opacity-100' : 'opacity-0 hidden sm:block'
              }`}
            >
              {item.name}
            </span>
          </div>
          <div
            className={`ml-3 mt-1 pl-2 border-l border-white/20 flex flex-col gap-1 transition-opacity duration-200 ${
              showLabel ? 'opacity-100' : 'opacity-0 hidden sm:flex'
            }`}
          >
            {item.children.map((child) => (
              <NavLink
                key={child.name}
                to={child.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-200 min-h-[36px] ${
                    isActive
                      ? 'bg-[#3A3A85] border border-[#4E4E91] text-white font-bold'
                      : 'text-white/70 hover:bg-white/10 hover:text-white'
                  } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60`
                }
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{child.icon}</span>
                <span className="text-xs whitespace-nowrap">{child.name}</span>
              </NavLink>
            ))}
          </div>
        </div>
      );
    }
    return (
      <NavLink
        key={item.name}
        to={item.path}
        className={({ isActive }) =>
          `flex items-center gap-3 px-3.5 py-2.5 rounded-lg transition-all duration-200 min-h-[44px] ${
            isActive
              ? 'bg-[#3A3A85] border border-[#4E4E91] text-white font-bold'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60`
        }
        title={!showLabel ? item.name : undefined}
      >
        <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center">{item.icon}</span>
        <span
          className={`font-semibold text-sm whitespace-nowrap transition-opacity duration-200 ${
            showLabel ? 'opacity-100' : 'opacity-0 hidden sm:block'
          }`}
        >
          {item.name}
        </span>
      </NavLink>
    );
  });
}

export default function SidebarBase({ navItems, bottomItems, collapsed = true, onHoverChange }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isTouchOpen, setIsTouchOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const asideRef = useRef(null);
  const hoverCapable = !isCoarsePointer;
  const { logout, user } = useAuth();

  useEffect(() => {
    const coarseMql = window.matchMedia('(pointer: coarse)');
    const mobileMql = window.matchMedia('(max-width: 639px)');
    const updateCoarse = () => setIsCoarsePointer(coarseMql.matches);
    const updateMobile = () => setIsMobile(mobileMql.matches);
    updateCoarse();
    updateMobile();
    coarseMql.addEventListener('change', updateCoarse);
    mobileMql.addEventListener('change', updateMobile);
    return () => {
      coarseMql.removeEventListener('change', updateCoarse);
      mobileMql.removeEventListener('change', updateMobile);
    };
  }, []);

  useLockBodyScroll(isMobile && isMobileOpen);

  const handleMouseEnter = useCallback(() => {
    if (isMobile || isCoarsePointer) return;
    setIsHovered(true);
    onHoverChange?.(true);
  }, [isMobile, isCoarsePointer, onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    if (isMobile || isCoarsePointer) return;
    setIsHovered(false);
    onHoverChange?.(false);
  }, [isMobile, isCoarsePointer, onHoverChange]);

  const handleRailClick = () => {
    if (isMobile) {
      setIsMobileOpen((v) => !v);
      return;
    }
    if (isCoarsePointer) {
      setIsTouchOpen((v) => !v);
    }
  };

  const closeMobile = useCallback(() => setIsMobileOpen(false), []);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      const isCustomer = user?.role === 'customer' || import.meta.env.VITE_APP_MODE === 'customer';
      await logout();
      const redirectUrl = isCustomer ? (import.meta.env.BASE_URL || '/') : '/';
      window.location.replace(redirectUrl);
    } catch (err) {
      console.error('Logout failed:', err);
      setLoggingOut(false);
      setShowLogoutConfirm(false);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setIsMobileOpen(false);
        setIsTouchOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isExpanded = isMobile ? isMobileOpen : isFocusWithin || (hoverCapable ? isHovered : isTouchOpen);
  const showLabel = isExpanded;

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label={isMobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={isMobileOpen}
          onClick={() => setIsMobileOpen((v) => !v)}
          className="fixed top-4 left-4 z-[45] sm:hidden w-11 h-11 flex items-center justify-center rounded-xl bg-[#252578] text-white shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {isMobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-slate-900/50 backdrop-blur-sm sm:hidden"
            onClick={closeMobile}
            aria-hidden="true"
          />
        )}

        <aside
          ref={asideRef}
          className={`fixed left-0 top-0 h-screen bg-[#252578] text-white flex flex-col justify-between overflow-hidden z-40 sm:hidden transition-transform duration-300 ease-in-out shadow-2xl ${
            isMobileOpen ? 'translate-x-0' : '-translate-x-full'
          } w-4/5 max-w-xs`}
          role="navigation"
          aria-label="Main navigation"
          onFocusCapture={() => setIsFocusWithin(true)}
          onBlurCapture={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setIsFocusWithin(false);
          }}
        >
          <div>
            {/* TS Canonical Brand Lockup */}
            <Link
              to="/"
              className="flex items-center h-20 px-4 gap-3 flex-shrink-0 border-b border-white/10"
              onClick={closeMobile}
            >
              <div className="h-8 flex-shrink-0 flex items-center">
                <img src={sbsiLogo} alt="SBSI" className="h-full w-auto object-contain" />
              </div>
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-bold tracking-wider uppercase text-white font-sans">
                  TICKETING
                </span>
                <span className="text-[11px] font-normal tracking-normal text-white/80 font-sans">
                  SYSTEM
                </span>
              </div>
            </Link>

            <nav className="flex flex-col gap-1.5 px-3 pt-4">
              <span className="text-[10px] font-bold text-white/60 tracking-wider uppercase px-3 mb-1">
                MAIN
              </span>
              <NavList items={navItems} collapsed={false} expanded={true} />
              {bottomItems && bottomItems.length > 0 && (
                <>
                  <div className="mx-2 my-2 h-px bg-white/10 flex-shrink-0" />
                  <NavList items={bottomItems} collapsed={false} expanded={true} />
                </>
              )}
            </nav>
          </div>

          {/* Pinned Logout Footer */}
          <div className="p-3 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-3 w-full px-3.5 py-2.5 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors text-sm font-semibold"
            >
              <LogOut size={20} className="text-white shrink-0" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <ConfirmationModal
          isOpen={showLogoutConfirm}
          onClose={() => setShowLogoutConfirm(false)}
          onConfirm={handleLogout}
          title="Sign Out"
          description="Are you sure you want to sign out of your session?"
          confirmLabel="Sign Out"
          variant="destructive"
          loading={loggingOut}
        />
      </>
    );
  }

  return (
    <>
      {isExpanded && (
        <div
          className="fixed inset-0 z-30 bg-black/10 hidden sm:block"
          onClick={() => {
            setIsTouchOpen(false);
            setIsHovered(false);
            onHoverChange?.(false);
          }}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        className={`hidden sm:flex fixed left-0 top-0 h-screen bg-[#252578] text-white flex-col justify-between overflow-hidden z-40 transition-all duration-200 ease-in-out ${
          isExpanded ? 'w-64 shadow-2xl' : 'w-20 shadow-none'
        }`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocusCapture={() => setIsFocusWithin(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setIsFocusWithin(false);
        }}
        onClick={isCoarsePointer ? handleRailClick : undefined}
        role="navigation"
        aria-label="Main navigation"
        tabIndex={-1}
      >
        <div>
          {/* Canonical TS Brand Header Lockup */}
          <Link
            to="/"
            className={`flex items-center h-20 px-4 gap-3 flex-shrink-0 border-b border-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${
              !showLabel ? 'justify-center' : ''
            }`}
          >
            <div className={`${!showLabel ? 'h-6 max-w-[48px]' : 'h-8'} flex-shrink-0 flex items-center justify-center transition-all duration-200`}>
              <img src={sbsiLogo} alt="SBSI" className="h-full w-auto object-contain" />
            </div>
            {showLabel && (
              <div className="flex flex-col leading-tight animate-fade-slide-in">
                <span className="text-sm font-bold tracking-wider uppercase text-white font-sans">
                  TICKETING
                </span>
                <span className="text-[11px] font-normal tracking-normal text-white/80 font-sans">
                  SYSTEM
                </span>
              </div>
            )}
          </Link>

          <nav className="flex flex-col gap-1.5 px-3 pt-4">
            {showLabel && (
              <span className="text-[10px] font-bold text-white/60 tracking-wider uppercase px-3 mb-1 animate-fade-slide-in">
                MAIN
              </span>
            )}
            <NavList items={navItems} collapsed={!isExpanded} expanded={isExpanded} />
            {bottomItems && bottomItems.length > 0 && (
              <>
                <div className="mx-2 my-2 h-px bg-white/10 flex-shrink-0" />
                <NavList items={bottomItems} collapsed={!isExpanded} expanded={isExpanded} />
              </>
            )}
          </nav>
        </div>

        {/* Pinned Logout Footer */}
        <div className="p-3 border-t border-white/10">
          <button
            type="button"
            onClick={() => setShowLogoutConfirm(true)}
            className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-lg text-white/80 hover:bg-white/10 hover:text-white transition-colors text-sm font-semibold ${
              !showLabel ? 'justify-center' : ''
            }`}
            title={!showLabel ? 'Logout' : undefined}
          >
            <LogOut size={20} className="text-white shrink-0" />
            {showLabel && <span>Logout</span>}
          </button>
        </div>
      </aside>

      <ConfirmationModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={handleLogout}
        title="Sign Out"
        description="Are you sure you want to sign out of your session?"
        confirmLabel="Sign Out"
        variant="destructive"
        loading={loggingOut}
      />
    </>
  );
}
