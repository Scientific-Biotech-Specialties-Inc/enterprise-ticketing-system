import React from 'react';
import { Settings, Construction } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';

export default function AdminSettings() {
  return (
    <div className="space-y-6">
      <PageHeader
        pattern="B"
        title="Admin Settings"
        subtitle="Configure system preferences, notification settings, SLA thresholds, and integration options."
      />
      <div className="flex flex-col items-center justify-center min-h-[45vh] text-center">
        <div className="bg-card rounded-xl shadow-xs border border-border p-12 max-w-lg w-full">
          <div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-6 text-accent">
            <Settings className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-bold text-slate-dark mb-2">Settings</h2>
          <div className="flex items-center justify-center gap-2 mb-4">
            <Badge variant="amber" className="gap-1.5 py-1 px-3">
              <Construction className="w-3.5 h-3.5" />
              <span>Coming Soon</span>
            </Badge>
          </div>
          <p className="text-slate-muted text-sm leading-relaxed">
            Configure system preferences, notification settings, SLA thresholds, and integration options.
            This feature is currently under development.
          </p>
        </div>
      </div>
    </div>
  );
}
