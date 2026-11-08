import React from 'react';
import { CalendarDays, Mail, Briefcase, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

export default function ProfileHero({ profile }) {
  const initials = ((profile.firstName?.[0] || '') + (profile.lastName?.[0] || '')).toUpperCase() || 'U';
  const fullName = [profile.firstName, profile.middleName, profile.lastName].filter(Boolean).join(' ');

  return (
    <div className="bg-card rounded-xl border border-border shadow-xs overflow-hidden font-sans">
      <div className="h-24 bg-gradient-to-r from-primary to-accent" />
      <div className="px-6 pb-6">
        <div className="flex items-end justify-between -mt-10 mb-4">
          <div className="w-20 h-20 rounded-xl bg-primary border-4 border-surface flex items-center justify-center text-white text-2xl font-bold shadow-md select-none">
            {initials}
          </div>
          <Badge variant="success" className="mb-1">
            Active
          </Badge>
        </div>

        <h2 className="text-lg font-bold text-dark-slate">{fullName}</h2>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-slate">
            <Briefcase size={14} className="text-muted-slate" />
            {profile.role} · {profile.department}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-slate">
            <Mail size={14} className="text-muted-slate" />
            {profile.email}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-slate">
            <CalendarDays size={14} className="text-muted-slate" />
            Member since {profile.dateJoined}
          </span>
          {profile.lastSynced && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-0.5 rounded-full bg-accent/10 text-primary border border-accent/20">
              <RefreshCw size={11} className="text-accent" />
              Auth Synced: {profile.lastSynced}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
