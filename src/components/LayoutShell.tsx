import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Bot,
  BookOpen,
  Compass,
  History,
  Menu,
  Play,
  Shield,
  Sparkles,
  Square,
  UserCheck,
  X,
} from 'lucide-react';
import { useTwin } from '../context/TwinContext';
import { TwinAvatar } from './TwinAvatar';

const NAV_ITEMS = [
  { path: '/', label: 'Overview', Icon: Compass },
  { path: '/demo', label: 'Interactive Demo', Icon: Play },
  { path: '/onboarding', label: 'Onboarding', Icon: UserCheck },
  { path: '/twin', label: 'Twin & Memory', Icon: BookOpen },
  { path: '/teach', label: 'Teach Mode', Icon: Sparkles },
  { path: '/skills', label: 'Skill Library', Icon: Activity },
  { path: '/agent', label: 'Agent Cockpit', Icon: Bot },
  { path: '/history', label: 'Runs & Ledger', Icon: History },
  { path: '/settings/privacy', label: 'Privacy & Data', Icon: Shield },
];

export const LayoutShell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const location = useLocation();
  const { ownerId, demoActive, exitDemoSandbox, workspace, setRunMode } = useTwin();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeMode = workspace?.activeMode ?? 'twin';
  const displayName = workspace?.profile.established && workspace.profile.displayName
    ? workspace.profile.displayName
    : 'Unestablished Twin';

  const handleEmergencyPause = async () => {
    try {
      await setRunMode('paused');
    } catch {
      // handled cleanly via context error
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#FAFAFA] text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
        <div className="h-16 px-5 flex items-center border-b border-slate-200">
          <Link to="/" className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            TwinMe Studio
          </Link>
        </div>

        <div className="p-4 border-b border-slate-200 flex items-center gap-3">
          <TwinAvatar ownerId={ownerId} mode={activeMode} size={44} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900 truncate">{displayName}</p>
            <p className="text-xs text-slate-500 truncate font-mono">
              {workspace?.profile.accountType === 'google' ? workspace.profile.email : 'Individual Guest'}
            </p>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary Workspace Navigation">
          {NAV_ITEMS.map(({ path, label, Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded-md transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 text-xs text-slate-500 space-y-1.5">
          <p className="font-medium text-slate-700">Active Mode: <span className="font-mono">{activeMode}</span></p>
          {demoActive && (
            <button
              type="button"
              onClick={() => void exitDemoSandbox()}
              className="text-red-700 font-semibold hover:underline block"
            >
              Reset &amp; Exit Demo Sandbox
            </button>
          )}
          <p>
            <Link to="/fixture/research" className="text-blue-800 hover:underline">
              Open Safe Research Fixture
            </Link>
          </p>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Strict 3-Zone Top Bar */}
        <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur border-b border-slate-200 px-4 lg:px-8 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(!mobileOpen)}
              className="lg:hidden p-2 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
              aria-label="Toggle navigation menu"
            >
              {mobileOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
            <h1 className="font-display text-base font-semibold text-slate-900 truncate whitespace-nowrap">
              {title}
            </h1>
          </div>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
            <Link to="/twin" className="hover:text-slate-900 whitespace-nowrap shrink-0">Twin</Link>
            <Link to="/teach" className="hover:text-slate-900 whitespace-nowrap shrink-0">Teach</Link>
            <Link to="/skills" className="hover:text-slate-900 whitespace-nowrap shrink-0">Skills</Link>
            <Link to="/agent" className="hover:text-slate-900 whitespace-nowrap shrink-0">Agent</Link>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={handleEmergencyPause}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-md border border-red-300 bg-white text-red-700 hover:bg-red-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              <span>Pause Agent</span>
            </button>
          </div>
        </header>

        {/* Mobile Drawer */}
        {mobileOpen && (
          <div className="lg:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-1">
            {NAV_ITEMS.map(({ path, label, Icon }) => {
              const active = location.pathname === path;
              return (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium rounded-md ${
                    active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        )}

        <main className="flex-1 px-4 py-6 lg:px-8 lg:py-8 max-w-6xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
